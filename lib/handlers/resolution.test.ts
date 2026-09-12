import { describe, expect, test } from "vitest";
import { fakeResolutionPage, type ScriptedPage } from "../resolution-page.fake";
import type { ResolutionPage, ResolutionResponse, OpenPage } from "../resolution-page";
import type { JobListEntry } from "../job-list-entry";
import { resolveJobs } from "./resolution";

// Settling is its own module with its own tests. The resolutions here are scripted
// as already-finished pages, so the step is handed a waitForLoad that does nothing
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

// Hands every job's resolution a page running the same script, and counts the openPages so a
// test can see how many resolutions overlapped and whether each one was shut down.
// The pause inside goto is what lets overlapping resolutions actually interleave;
// without it each job's resolution would run to the end before the next one started.
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


// The scripted fake ignores the address it is handed and serves its pages in
// order, which suits a test about one job walking several pages. The lane
// tests below are about several jobs on different hosts instead, so this
// factory picks each job's page by the address it asks for.
function factoryByUrl(pages: Record<string, ScriptedPage>): () => Promise<OpenPage> {
  return async () => {
    let inner: ResolutionPage | null = null;
    const handlers: ((response: ResolutionResponse) => void)[] = [];

    const page: ResolutionPage = {
      async goto(url, options) {
        const scripted = pages[url];
        if (!scripted) throw new Error(`no page scripted for ${url}`);
        inner = fakeResolutionPage([scripted]);
        for (const handler of handlers) inner.on("response", handler);
        return inner.goto(url, options);
      },
      url: () => inner?.url() ?? "",
      content: async () => (inner ? inner.content() : ""),
      title: async () => (inner ? inner.title() : ""),
      $$eval: async (selector, fn) => (inner ? inner.$$eval(selector, fn) : fn([])),
      on(_event, handler) {
        handlers.push(handler);
        inner?.on("response", handler);
      },
      off(_event, handler) {
        const at = handlers.indexOf(handler);
        if (at !== -1) handlers.splice(at, 1);
        inner?.off("response", handler);
      },
    };

    return { page, close: async () => {} };
  };
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
      { openPage: factoryFor(script), fastConcurrency: 2, waitForLoad: NO_WAIT }
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
      fastConcurrency: 1,
      waitForLoad: NO_WAIT,
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
      fastConcurrency: 1,
      waitForLoad: NO_WAIT,
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
      fastConcurrency: 1,
      waitForLoad: NO_WAIT,
    });

    expect(result.jobs[0]?.status).toBeUndefined();
  });
});

// A source that refused us, or a page the browser could not load, says
// nothing about the job. Parking it would lose a good job to someone else's
// bad afternoon, so it keeps its place and the next run tries again.
describe("a failure the source may not repeat", () => {
  test("a refused page keeps the job in the backlog", async () => {
    const script: ScriptedPage[] = [
      {
        url: "https://board.example/listing/1",
        responses: [{ url: "https://board.example/listing/1", status: 403 }],
      },
    ];

    const result = await resolveJobs([job("a", "https://board.example/listing/1")], {
      openPage: factoryFor(script),
      fastConcurrency: 1,
      waitForLoad: NO_WAIT,
    });

    expect(result.jobs[0]?.status ?? null).toBeNull();
    expect(result.jobs[0]?.is_resolved).toBe(false);
    expect(result.jobs[0]?.resolved_url ?? null).toBeNull();
  });

  test("a page the browser could not load keeps the job in the backlog", async () => {
    const script: ScriptedPage[] = [
      { url: "https://board.example/listing/1", failsToLoad: true },
    ];

    const result = await resolveJobs([job("a", "https://board.example/listing/1")], {
      openPage: factoryFor(script),
      fastConcurrency: 1,
      waitForLoad: NO_WAIT,
    });

    expect(result.jobs[0]?.status ?? null).toBeNull();
    expect(result.jobs[0]?.is_resolved).toBe(false);
  });

  test("a job that keeps its place still writes a row saying why", async () => {
    const script: ScriptedPage[] = [
      {
        url: "https://board.example/listing/1",
        responses: [{ url: "https://board.example/listing/1", status: 403 }],
      },
    ];
    const written: { event: string; reason?: string }[] = [];

    await resolveJobs([job("a", "https://board.example/listing/1")], {
      openPage: factoryFor(script),
      fastConcurrency: 1,
      waitForLoad: NO_WAIT,
      trace: {
        write: async (row) => {
          written.push({ event: row.event, reason: row.reason });
        },
        failureCount: () => 0,
        countsForRun: async () => [],
      },
      runId: "run-1",
      step: "resolution",
    });

    expect(written).toEqual([{ event: "resolution_failed", reason: "page_refused" }]);
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
      fastConcurrency: 1,
      waitForLoad: NO_WAIT,
    });

    expect(result.jobs[0]?.status).toBe("unresolvable");
    expect(result.jobs[0]?.is_resolved).toBe(false);
    expect(result.jobs[0]?.resolved_url ?? null).toBeNull();
  });

  // Dedupe reads a shared resolved URL as proof that two jobs are one, so a
  // page resolution merely passed through must never be written as an answer.
  test("holds no URL resolution merely passed through", async () => {
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
      fastConcurrency: 1,
      waitForLoad: NO_WAIT,
    });

    expect(result.jobs[0]?.resolved_url ?? null).toBeNull();
  });
});

describe("AC 16, 17, 19: a job's resolution that reaches a blacklisted host", () => {
  const blacklisted: ScriptedPage[] = [
    { url: "https://www.jobleads.com/jobs/1", html: "<p>A job posting</p>" },
  ];

  test("marks a collected job for deletion and writes no URL", async () => {
    const result = await resolveJobs([job("a", "https://board.example/listing/1")], {
      openPage: factoryFor(blacklisted),
      fastConcurrency: 1,
      waitForLoad: NO_WAIT,
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
      { openPage: factoryFor(blacklisted), fastConcurrency: 1, waitForLoad: NO_WAIT }
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
      fastConcurrency: 1,
      waitForLoad: NO_WAIT,
    });

    expect(result.jobs[0]?.is_resolved).toBe(true);
  });

  // One job's resolution blowing up must not take the rest of the run with it. The
  // job it happened to is left exactly as it arrived, so the next run picks it
  // up again rather than parking a job the browser, not the posting, failed.
  test("resolves the remaining jobs where one job's resolution throws", async () => {
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
      { openPage, fastConcurrency: 1, waitForLoad: NO_WAIT }
    );

    expect(result.jobs.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(result.jobs[1]?.is_resolved).toBe(true);
    expect(result.jobs[0]?.status).toBeUndefined();
    expect(result.jobs[0]?.is_resolved).toBeUndefined();
  });

  test("resolves no more jobs at a time than the concurrency it was given", async () => {
    const script: ScriptedPage[] = [
      { url: "https://employer.example/careers/9", html: "<p>A job posting</p>" },
    ];
    const log = newLog();

    await resolveJobs(
      ["a", "b", "c", "d", "e"].map((id) => job(id, `https://board.example/listing/${id}`)),
      { openPage: countingFactory(script, log), fastConcurrency: 2, waitForLoad: NO_WAIT }
    );

    expect(log.maxOpenAtOnce).toBe(2);
    expect(log.opened).toBe(5);
  });

  // One site's cookies and consent state must never reach the next job's
  // resolution, which is what closing every open page is for.
  test("closes every page it opened", async () => {
    const script: ScriptedPage[] = [
      { url: "https://employer.example/careers/9", html: "<p>A job posting</p>" },
    ];
    const log = newLog();

    await resolveJobs(
      ["a", "b", "c"].map((id) => job(id, `https://board.example/listing/${id}`)),
      { openPage: countingFactory(script, log), fastConcurrency: 2, waitForLoad: NO_WAIT }
    );

    expect(log.closed).toBe(log.opened);
    expect(log.closed).toBe(3);
  });
});

// The two lanes. Every job starts in the fast one. A host that refuses us
// sends its remaining jobs to the slow lane, which runs once the fast lane is
// done and that host has had time to cool off.
describe("a host that refuses us is moved to the slow lane", () => {
  // a.example refuses its first job and would answer its second. b.example
  // answers. Dealt round-robin the order is a1, b1, a2.
  const twoHosts: Record<string, ScriptedPage> = {
    "https://a.example/1": {
      url: "https://a.example/1",
      responses: [{ url: "https://a.example/1", status: 403 }],
    },
    "https://a.example/2": { url: "https://a.example/2", html: "<p>A job posting</p>" },
    "https://b.example/1": { url: "https://b.example/1", html: "<p>A job posting</p>" },
  };

  function threeJobs(): JobListEntry[] {
    return [
      job("a1", "https://a.example/1"),
      job("a2", "https://a.example/2"),
      job("b1", "https://b.example/1"),
    ];
  }

  function laneOptions(waits: number[]) {
    return {
      openPage: factoryByUrl(twoHosts),
      fastConcurrency: 1,
      slowConcurrency: 1,
      slowPauseMs: 12_000,
      waitForLoad: NO_WAIT,
      wait: async (ms: number) => {
        waits.push(ms);
      },
    };
  }

  // Two jobs reach the slow lane, so exactly one pause separates them. A
  // count rather than a floor, because pausing before the first job too
  // would still leave every pause the right length.
  test("the slow lane pauses between its jobs and not before its first", async () => {
    const waits: number[] = [];

    await resolveJobs(threeJobs(), laneOptions(waits));

    expect(waits).toEqual([12_000]);
  });

  // The refusal was about the moment, not the job, so a1 keeps its place.
  test("a job refused in both lanes still keeps its place in the backlog", async () => {
    const result = await resolveJobs(threeJobs(), laneOptions([]));

    expect(result.jobs.find((entry) => entry.id === "a1")?.status ?? null).toBeNull();
  });

  test("the other job on the refused host still resolves, in the slow lane", async () => {
    const result = await resolveJobs(threeJobs(), laneOptions([]));

    expect(result.jobs.find((entry) => entry.id === "a2")?.resolved_url).toBe(
      "https://a.example/2"
    );
  });

  test("a job on an untouched host is unaffected", async () => {
    const result = await resolveJobs(threeJobs(), laneOptions([]));

    expect(result.jobs.find((entry) => entry.id === "b1")?.resolved_url).toBe(
      "https://b.example/1"
    );
  });

  // The caller reads the list by position, so whatever order the lanes ran
  // in, what comes back has to line up with what went in.
  test("the list comes back in the order it was handed over", async () => {
    const result = await resolveJobs(threeJobs(), laneOptions([]));

    expect(result.jobs.map((entry) => entry.id)).toEqual(["a1", "a2", "b1"]);
  });

  // A job deferred by the fast lane is resolved by the slow one, and only one
  // of the two may speak for it.
  test("a job carried into the slow lane writes one trace row, not two", async () => {
    const written: { job_id: string; event: string; reason?: string }[] = [];

    await resolveJobs(threeJobs(), {
      ...laneOptions([]),
      trace: {
        write: async (row) => {
          written.push({ job_id: row.job_id, event: row.event, reason: row.reason });
        },
        failureCount: () => 0,
        countsForRun: async () => [],
      },
      runId: "run-1",
      step: "resolution",
    });

    expect(written.map((row) => row.job_id).sort()).toEqual(["a1", "a2", "b1"]);
    expect(written.find((row) => row.job_id === "a1")?.reason).toBe("page_refused");
  });

  // A 404 is the same answer every run, so it says nothing about the host.
  // Demoting on it would send a whole site to the slow lane over one dead job.
  test("a page that is merely gone does not move its host", async () => {
    const gone: Record<string, ScriptedPage> = {
      "https://a.example/1": {
        url: "https://a.example/1",
        responses: [{ url: "https://a.example/1", status: 404 }],
      },
      "https://a.example/2": { url: "https://a.example/2", html: "<p>A job posting</p>" },
    };
    const waits: number[] = [];

    await resolveJobs([job("a1", "https://a.example/1"), job("a2", "https://a.example/2")], {
      openPage: factoryByUrl(gone),
      fastConcurrency: 1,
      slowConcurrency: 1,
      slowPauseMs: 12_000,
      waitForLoad: NO_WAIT,
      wait: async (ms: number) => {
        waits.push(ms);
      },
    });

    expect(waits).toEqual([]);
  });

  test("a run where nothing refuses us never reaches the slow lane", async () => {
    const clean: Record<string, ScriptedPage> = {
      "https://a.example/1": { url: "https://a.example/1", html: "<p>A job posting</p>" },
      "https://b.example/1": { url: "https://b.example/1", html: "<p>A job posting</p>" },
    };
    const waits: number[] = [];

    await resolveJobs([job("a1", "https://a.example/1"), job("b1", "https://b.example/1")], {
      openPage: factoryByUrl(clean),
      fastConcurrency: 2,
      slowConcurrency: 1,
      slowPauseMs: 12_000,
      waitForLoad: NO_WAIT,
      wait: async (ms: number) => {
        waits.push(ms);
      },
    });

    expect(waits).toEqual([]);
  });

  // A block is temporary, so a host judged once must not be judged forever.
  // The count of pages opened is what tells the two apart. A run that
  // remembered a.example would open three — b1 in the fast lane, then a1 and
  // a2 in the slow one — because a1 would be deferred without ever being
  // tried. A run starting clean opens four, spending one on the attempt that
  // learns the refusal all over again.
  test("the set of refused hosts is empty again on the next run", async () => {
    function countingOptions(opens: { count: number }) {
      const openPage = factoryByUrl(twoHosts);
      return {
        openPage: async () => {
          opens.count += 1;
          return openPage();
        },
        fastConcurrency: 1,
        slowConcurrency: 1,
        slowPauseMs: 12_000,
        waitForLoad: NO_WAIT,
        wait: async () => {},
      };
    }

    const first = { count: 0 };
    await resolveJobs(threeJobs(), countingOptions(first));

    const second = { count: 0 };
    await resolveJobs(threeJobs(), countingOptions(second));

    expect(first.count).toBe(4);
    expect(second.count).toBe(first.count);
  });
});

// Only one of the permanent failures was ever proven to park a job. If any of
// the others quietly became retryable, nothing would have caught it.
describe("every permanent failure parks the job", () => {
  const permanent: { reason: string; script: ScriptedPage[] }[] = [
    {
      reason: "page_unavailable",
      script: [
        {
          url: "https://board.example/listing/1",
          responses: [{ url: "https://board.example/listing/1", status: 404 }],
        },
      ],
    },
    {
      reason: "dead_end",
      script: [
        { url: "https://board.example/listing/1", html: applyLink("https://elsewhere.example/7") },
        {
          url: "https://elsewhere.example/7",
          html: '<form><input type="password" name="pw" /></form>',
        },
      ],
    },
    {
      reason: "posting_gone",
      script: [{ url: "https://board.example/listing/1?error=job_not_found" }],
    },
    {
      reason: "page_limit_reached",
      script: [
        { url: "https://a.example/1", html: applyLink("https://b.example/2") },
        { url: "https://b.example/2", html: applyLink("https://c.example/3") },
        { url: "https://c.example/3", html: applyLink("https://d.example/4") },
        { url: "https://d.example/4", html: applyLink("https://e.example/5") },
      ],
    },
  ];

  for (const { reason, script } of permanent) {
    test(`${reason} takes the job out of the backlog`, async () => {
      const result = await resolveJobs([job("a", script[0]!.url)], {
        openPage: factoryFor(script),
        fastConcurrency: 1,
        waitForLoad: NO_WAIT,
      });

      expect(result.jobs[0]?.status).toBe("unresolvable");
      expect(result.jobs[0]?.is_resolved).toBe(false);
    });
  }
});
