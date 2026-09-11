import { describe, expect, test } from "vitest";
import { fakeResolutionPage, type ScriptedPage } from "../resolution-page.fake";
import type { ResolutionPage, OpenPage } from "../resolution-page";
import type { JobListEntry } from "../job-list-entry";
import { resolveJobs } from "./resolution";

// Settling is its own module with its own tests. The walks here are scripted
// as already-finished pages, so the step is handed a settle that does nothing
// and each test says only what it is about.
const NO_WAIT = async () => {};

// A link a page offers, worded so the apply-link filter keeps it.
function applyLink(href: string): string {
  return `<a href="${href}">Apply</a>`;
}

// What the factory did while the step ran: how many pages it opened, how many
// were closed, and the most that were ever open at one time.
interface FactoryLog {
  opened: number;
  closed: number;
  maxOpenAtOnce: number;
  openNow: number;
}

function newLog(): FactoryLog {
  return { opened: 0, closed: 0, maxOpenAtOnce: 0, openNow: 0 };
}

// Hands every walk a page running the same script, and counts the leases so a
// test can see how many walks overlapped and whether each one was shut down.
// The pause inside goto is what lets overlapping walks actually interleave;
// without it each walk would run to the end before the next one started.
function countingFactory(
  script: ScriptedPage[],
  log: FactoryLog
): () => Promise<OpenPage> {
  return async () => {
    const page = fakeResolutionPage(script);
    log.opened += 1;
    log.openNow += 1;
    log.maxOpenAtOnce = Math.max(log.maxOpenAtOnce, log.openNow);

    const paused: ResolutionPage = {
      ...page,
      async goto(url, options) {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return page.goto(url, options);
      },
    };

    return {
      page: paused,
      async close() {
        log.openNow -= 1;
        log.closed += 1;
      },
    };
  };
}

// The plainest factory there is: one script, no counting.
function factoryFor(script: ScriptedPage[]): () => Promise<OpenPage> {
  return async () => ({
    page: fakeResolutionPage(script),
    close: async () => {},
  });
}

function job(id: string, url: string, fields: Partial<JobListEntry> = {}): JobListEntry {
  return { id, original_url: url, collector: "adzuna", ...fields };
}

describe("AC 51, 52: the step takes the whole list and opens nothing of its own", () => {
  test("returns every job it was handed, along with its warnings", async () => {
    const script: ScriptedPage[] = [
      { url: "https://employer.example/careers/9", html: "<p>A job posting</p>" },
    ];

    const result = await resolveJobs(
      [
        job("a", "https://board.example/listing/1"),
        job("b", "https://board.example/listing/2"),
      ],
      { openPage: factoryFor(script), concurrency: 2, settle: NO_WAIT }
    );

    expect(result.jobs.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(result.warnings).toEqual([]);
  });

  // Everything the step needs arrives as an argument. Handed a page factory
  // and nothing else, it still does the whole job — no database, no browser.
  test("runs with a page factory as its only dependency", async () => {
    const script: ScriptedPage[] = [
      { url: "https://employer.example/careers/9", html: "<p>A job posting</p>" },
    ];

    const result = await resolveJobs([job("a", "https://board.example/listing/1")], {
      openPage: factoryFor(script),
      concurrency: 1,
      settle: NO_WAIT,
    });

    expect(result.jobs[0]?.is_resolved).toBe(true);
  });
});

describe("AC 47, 50: a job that resolved", () => {
  test("carries the URL the rules accepted and is marked resolved", async () => {
    const script: ScriptedPage[] = [
      { url: "https://employer.example/careers/9", html: "<p>A job posting</p>" },
    ];

    const result = await resolveJobs([job("a", "https://board.example/listing/1")], {
      openPage: factoryFor(script),
      concurrency: 1,
      settle: NO_WAIT,
    });

    expect(result.jobs[0]?.resolved_url).toBe("https://employer.example/careers/9");
    expect(result.jobs[0]?.is_resolved).toBe(true);
  });

  // The job list carries no status in the first place, and resolution adds
  // none: a job that resolved stays wherever the user had it.
  test("takes no status", async () => {
    const script: ScriptedPage[] = [
      { url: "https://employer.example/careers/9", html: "<p>A job posting</p>" },
    ];

    const result = await resolveJobs([job("a", "https://board.example/listing/1")], {
      openPage: factoryFor(script),
      concurrency: 1,
      settle: NO_WAIT,
    });

    expect(result.jobs[0]?.status).toBeUndefined();
  });
});

describe("AC 48, 49: a job resolution could not place", () => {
  test("is markUnresolvable as unresolvable with no URL written", async () => {
    const script: ScriptedPage[] = [
      {
        url: "https://board.example/listing/1",
        responses: [{ url: "https://board.example/listing/1", status: 404 }],
      },
    ];

    const result = await resolveJobs([job("a", "https://board.example/listing/1")], {
      openPage: factoryFor(script),
      concurrency: 1,
      settle: NO_WAIT,
    });

    expect(result.jobs[0]?.status).toBe("unresolvable");
    expect(result.jobs[0]?.is_resolved).toBe(false);
    expect(result.jobs[0]?.resolved_url ?? null).toBeNull();
  });

  // Dedupe reads a shared resolved URL as proof that two jobs are one, so a
  // page the walk merely passed through must never be written as an answer.
  test("holds no URL the walk merely passed through", async () => {
    const script: ScriptedPage[] = [
      {
        url: "https://board.example/listing/1",
        html: applyLink("https://elsewhere.example/apply/7"),
      },
      {
        url: "https://elsewhere.example/apply/7",
        html: '<form><input type="password" name="pw" /></form>',
      },
    ];

    const result = await resolveJobs([job("a", "https://board.example/listing/1")], {
      openPage: factoryFor(script),
      concurrency: 1,
      settle: NO_WAIT,
    });

    expect(result.jobs[0]?.resolved_url ?? null).toBeNull();
  });
});

describe("AC 16, 17, 19: a walk that reaches a blacklisted host", () => {
  const blacklisted: ScriptedPage[] = [
    { url: "https://www.jobleads.com/jobs/1", html: "<p>A job posting</p>" },
  ];

  test("marks a collected job for deletion and writes no URL", async () => {
    const result = await resolveJobs([job("a", "https://board.example/listing/1")], {
      openPage: factoryFor(blacklisted),
      concurrency: 1,
      settle: NO_WAIT,
    });

    expect(result.jobs[0]?.delete_on_save).toBe("blacklisted_url");
    expect(result.jobs[0]?.is_resolved).toBe(false);
    expect(result.jobs[0]?.resolved_url ?? null).toBeNull();
  });

  // No collector will ever find a hand-entered job again, so dropping it
  // would destroy it for good. It is markUnresolvable instead, and stays repairable.
  test("parks a hand-entered job rather than dropping it", async () => {
    const result = await resolveJobs(
      [job("a", "https://board.example/listing/1", { collector: "user" })],
      { openPage: factoryFor(blacklisted), concurrency: 1, settle: NO_WAIT }
    );

    expect(result.jobs[0]?.delete_on_save).toBeUndefined();
    expect(result.jobs[0]?.status).toBe("unresolvable");
    expect(result.jobs[0]?.is_resolved).toBe(false);
  });
});

describe("AC 53, 54, 55, 56: how the step runs the list", () => {
  test("writes no trace and still resolves where it is handed no trace context", async () => {
    const script: ScriptedPage[] = [
      { url: "https://employer.example/careers/9", html: "<p>A job posting</p>" },
    ];

    const result = await resolveJobs([job("a", "https://board.example/listing/1")], {
      openPage: factoryFor(script),
      concurrency: 1,
      settle: NO_WAIT,
    });

    expect(result.jobs[0]?.is_resolved).toBe(true);
  });

  // One job's walk blowing up must not take the rest of the run with it. The
  // job it happened to is left exactly as it arrived, so the next run picks it
  // up again rather than parking a job the browser, not the posting, failed.
  test("walks the remaining jobs where one job's walk throws", async () => {
    const script: ScriptedPage[] = [
      { url: "https://employer.example/careers/9", html: "<p>A job posting</p>" },
    ];
    let calls = 0;
    const openPage = async (): Promise<OpenPage> => {
      calls += 1;
      if (calls === 1) throw new Error("the browser would not open a context");
      return { page: fakeResolutionPage(script), close: async () => {} };
    };

    const result = await resolveJobs(
      [
        job("a", "https://board.example/listing/1"),
        job("b", "https://board.example/listing/2"),
      ],
      { openPage, concurrency: 1, settle: NO_WAIT }
    );

    expect(result.jobs.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(result.jobs[1]?.is_resolved).toBe(true);
    expect(result.jobs[0]?.status).toBeUndefined();
    expect(result.jobs[0]?.is_resolved).toBeUndefined();
  });

  test("walks no more jobs at a time than the concurrency it was given", async () => {
    const script: ScriptedPage[] = [
      { url: "https://employer.example/careers/9", html: "<p>A job posting</p>" },
    ];
    const log = newLog();

    await resolveJobs(
      ["a", "b", "c", "d", "e"].map((id) => job(id, `https://board.example/listing/${id}`)),
      { openPage: countingFactory(script, log), concurrency: 2, settle: NO_WAIT }
    );

    expect(log.maxOpenAtOnce).toBe(2);
    expect(log.opened).toBe(5);
  });

  // One site's cookies and consent state must never reach the next job's
  // walk, which is what closing every lease is for.
  test("closes every page it opened", async () => {
    const script: ScriptedPage[] = [
      { url: "https://employer.example/careers/9", html: "<p>A job posting</p>" },
    ];
    const log = newLog();

    await resolveJobs(
      ["a", "b", "c"].map((id) => job(id, `https://board.example/listing/${id}`)),
      { openPage: countingFactory(script, log), concurrency: 2, settle: NO_WAIT }
    );

    expect(log.closed).toBe(log.opened);
    expect(log.closed).toBe(3);
  });
});
