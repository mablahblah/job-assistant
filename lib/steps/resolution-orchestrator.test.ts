import { describe, expect, test } from "vitest";
import { fakeResolutionPage, type ScriptedPage } from "../resolution-page.fake";
import type { ResolutionBrowserSession } from "../resolution-page";
import { fakeJobService } from "../job-service.fake";
import { fakeSettingsService } from "../settings-service.fake";
import type { JobListEntry } from "../job-list-entry";
import type { TraceEvent, TraceService } from "../trace-service";
import { runResolution } from "./resolution-orchestrator";

// The leg end to end: the job-list pull, the walk, the dedupe and the second
// save, run against fakes rather than a database or a browser. What each of
// those steps does on its own is covered beside that step; this file asserts
// only that the leg runs them in order and that the rows come out right.

const RUN_ID = "run-1";
const COLLECTED_AT = new Date("2026-01-01T00:00:00.000Z");
const PRIORITY_LIST = ["collector:user", "collector:adzuna"];

// Settling is its own module with its own tests, so every walk here is
// scripted as an already-finished page.
const NO_SETTLE = async () => {};

function applyLink(href: string): string {
  return `<a href="${href}">Apply</a>`;
}

// A row already on file, the way resolution finds one.
function row(id: string, fields: Partial<JobListEntry> = {}): JobListEntry {
  return {
    id,
    collector: "adzuna",
    collected_at: COLLECTED_AT,
    created_at: COLLECTED_AT,
    status: "backlog",
    is_resolved: false,
    is_parsed: false,
    is_classified: false,
    original_url: `https://board.example/listing/${id}`,
    ...fields,
  };
}

// How many browsers the run launched and how many it shut down.
interface BrowserLog {
  launches: number;
  closes: number;
}

// Hands out one scripted page per call, in call order, from one browser. The
// tests below all run at a concurrency of one, so call order is job order.
function browserFor(
  scripts: ScriptedPage[][],
  log: BrowserLog
): () => Promise<ResolutionBrowserSession> {
  let served = 0;
  return async () => {
    log.launches += 1;
    return {
      openPage: async () => {
        const script = scripts[served] ?? [];
        served += 1;
        return { page: fakeResolutionPage(script), close: async () => {} };
      },
      async close() {
        log.closes += 1;
      },
    };
  };
}

function createFakeTraceService(): TraceService & { events: TraceEvent[] } {
  const events: TraceEvent[] = [];
  return {
    events,
    async write(event) {
      events.push(event);
    },
    failureCount() {
      return 0;
    },
  };
}

// Everything the leg needs, wired to fakes. The caller supplies the rows on
// file and the walk each job takes; the rest is the same every time.
function runLeg(
  rows: JobListEntry[],
  scripts: ScriptedPage[][],
  log: BrowserLog = { launches: 0, closes: 0 }
): {
  rows: JobListEntry[];
  trace: TraceService & { events: TraceEvent[] };
  log: BrowserLog;
  report: ReturnType<typeof runResolution>;
} {
  const trace = createFakeTraceService();
  const report = runResolution({
    jobService: fakeJobService(rows),
    settings: fakeSettingsService({
      getResolutionConcurrency: async () => 1,
      getSourcePriorityList: async () => PRIORITY_LIST,
    }),
    openBrowser: browserFor(scripts, log),
    collectedAt: COLLECTED_AT,
    runId: RUN_ID,
    trace,
    settle: NO_SETTLE,
  });
  return { rows, trace, log, report };
}

// A walk that arrives at the employer's own posting.
function arrivesAt(url: string): ScriptedPage[] {
  return [{ url, html: "<p>A job posting</p>" }];
}

describe("AC 5: a run with nothing to resolve costs no browser", () => {
  test("launches no browser where every job is already resolved or parked", async () => {
    const log = { launches: 0, closes: 0 };
    const { report } = runLeg(
      [row("a", { is_resolved: true }), row("b", { status: "unresolvable" })],
      [],
      log
    );

    const result = await report;

    expect(log.launches).toBe(0);
    expect(result.jobs).toEqual([]);
  });
});

describe("AC 74, 75: the leg runs its four parts in order", () => {
  test("queries, resolves, dedupes and saves, in that order", async () => {
    const { trace, report } = runLeg([row("a")], [arrivesAt("https://employer.example/9")]);

    await report;

    // Each step's rows arrive as that step runs, so the order they were
    // written in is the order the steps ran in.
    const steps: string[] = [];
    for (const event of trace.events) {
      if (steps[steps.length - 1] !== event.step) steps.push(event.step);
    }
    expect(steps[0]).toBe("resolution");
    expect(steps).toContain("post_resolution_save");
  });

  test("names the dedupe and save steps after resolution rather than collection", async () => {
    const { trace, report } = runLeg([row("a")], [arrivesAt("https://employer.example/9")]);

    await report;

    const steps = new Set(trace.events.map((event) => event.step));
    expect(steps.has("post_collection_dedupe")).toBe(false);
    expect(steps.has("post_collection_save")).toBe(false);
  });
});

describe("AC 76, 77, 81: what the rows hold once the leg has run", () => {
  test("a job that resolved carries its URL and is marked resolved", async () => {
    const rows = [row("a")];
    const { report } = runLeg(rows, [arrivesAt("https://employer.example/9")]);

    await report;

    expect(rows[0]?.resolved_url).toBe("https://employer.example/9");
    expect(rows[0]?.is_resolved).toBe(true);
  });

  test("a job that resolved is ready for parsing and no further", async () => {
    const rows = [row("a")];
    const { report } = runLeg(rows, [arrivesAt("https://employer.example/9")]);

    await report;

    expect(rows[0]?.is_resolved).toBe(true);
    expect(rows[0]?.is_parsed).toBe(false);
  });

  test("a job that failed to resolve is parked as unresolvable", async () => {
    const rows = [row("a")];
    const { report } = runLeg(rows, [
      [
        {
          url: "https://board.example/listing/a",
          responses: [{ url: "https://board.example/listing/a", status: 404 }],
        },
      ],
    ]);

    await report;

    expect(rows[0]?.status).toBe("unresolvable");
    expect(rows[0]?.is_resolved).toBe(false);
  });
});

describe("AC 78: a blacklisted job leaves no row behind", () => {
  test("its row is gone once the leg has run", async () => {
    const rows = [row("a")];
    const { report } = runLeg(rows, [arrivesAt("https://www.jobleads.com/jobs/1")]);

    await report;

    expect(rows.map((entry) => entry.id)).toEqual([]);
  });
});

describe("AC 79: two jobs that resolved to one posting leave one row", () => {
  test("one row remains and the other's departure is traced", async () => {
    const rows = [
      row("a", { raw_title: "Product Designer" }),
      row("b", { raw_title: "Product Designer" }),
    ];
    const { trace, report } = runLeg(rows, [
      [
        {
          url: "https://board.example/listing/a",
          html: applyLink("https://employer.example/9"),
        },
        { url: "https://employer.example/9", html: "<p>A job posting</p>" },
      ],
      [
        {
          url: "https://board.example/listing/b",
          html: applyLink("https://employer.example/9"),
        },
        { url: "https://employer.example/9", html: "<p>A job posting</p>" },
      ],
    ]);

    await report;

    expect(rows).toHaveLength(1);
    const departures = trace.events.filter(
      (event) => event.step === "post_resolution_dedupe" && event.event === "abandoned"
    );
    expect(departures).toHaveLength(1);
  });
});

describe("AC 80: what the leg hands back", () => {
  test("returns the job list along with the warnings its steps raised", async () => {
    const { report } = runLeg([row("a")], [arrivesAt("https://employer.example/9")]);

    const result = await report;

    expect(result.jobs.map((entry) => entry.id)).toEqual(["a"]);
    expect(result.warnings).toEqual([]);
  });

  // A lost trace write is counted rather than allowed to cancel a run over a
  // row of diagnostics, so the total is read once every step is done.
  test("reports how many trace writes the run lost", async () => {
    const { report } = runLeg([row("a")], [arrivesAt("https://employer.example/9")]);

    const result = await report;

    expect(result.traceFailures).toBe(0);
  });
});

describe("the browser the run launched", () => {
  test("is shut down once the leg is finished", async () => {
    const log = { launches: 0, closes: 0 };
    const { report } = runLeg([row("a")], [arrivesAt("https://employer.example/9")], log);

    await report;

    expect(log.launches).toBe(1);
    expect(log.closes).toBe(1);
  });
});
