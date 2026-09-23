import { describe, expect, test } from "vitest";
import { dedupeJobs } from "./dedupe";
import { fakeJobService } from "../services/job-service.fake";
import type { JobService } from "../services/job-service";
import type { JobListEntry } from "../types/job-list-entry";
import type { TraceEvent, TraceService } from "../services/trace-service";

// Covers only the trace rows the step writes. What it decides — which entries
// survive and which are marked away — is covered in dedupe.test.ts.

const PRIORITY_LIST = ["collector:greenhouse", "collector:adzuna"];
const RUN_ID = "run-1";
const STEP = "post_collection_dedupe";

// Fixed dates, so nothing in these tests depends on when they run.
const COLLECTED_AT = new Date("2026-03-01T00:00:00.000Z");
const POSTED_AT = new Date("2026-02-20T00:00:00.000Z");
// Under 24 hours after POSTED_AT, so a match on these two reads as hard.
const HOURS_LATER = new Date("2026-02-20T06:00:00.000Z");
// Well over 24 hours after it, so a match on these two reads as a repost.
const DAYS_LATER = new Date("2026-02-26T00:00:00.000Z");

function freshEntry(id: string, overrides: JobListEntry = {}): JobListEntry {
  return { id, collector: "adzuna", collected_at: COLLECTED_AT, ...overrides };
}

function storedRow(id: string, overrides: JobListEntry = {}): JobListEntry {
  return {
    id,
    collector: "greenhouse",
    collected_at: new Date("2026-01-01T00:00:00.000Z"),
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    status: "backlog",
    ...overrides,
  };
}

function withOriginalUrl(url: string): JobListEntry {
  return { original_url: url, original_url_match_key: url };
}

function createFakeTraceService(): TraceService & { events: TraceEvent[] } {
  const events: TraceEvent[] = [];
  return {
    events,
    async write(event) {
      events.push(event);
    },
    // No test here reads a summary back, so the fake answers with
    // nothing rather than keeping counts the tests would not check.
    async countsForRun() {
      return [];
    },
    failureCount() {
      return 0;
    },
  };
}

function runDedupe(jobs: JobListEntry[], jobService: JobService, trace: TraceService) {
  return dedupeJobs(jobs, {
    jobService,
    priorityList: PRIORITY_LIST,
    identifyingQueryValues: [],
    collectedAt: COLLECTED_AT,
    trace,
    runId: RUN_ID,
    step: STEP,
  });
}

// The detail a losing row carries is an object, not one of the two shapes the
// other steps write, so a test reads it through this rather than casting at
// every call.
function detailOf(event: TraceEvent | undefined): Record<string, string> {
  return (event?.detail ?? {}) as Record<string, string>;
}

// AC 73 and 84. Only the moments that matter leave a row: a job that passed
// through untouched, and the side of a merge that survived it, leave none.
describe("what leaves no row", () => {
  test("an entry nothing matched writes nothing", async () => {
    const trace = createFakeTraceService();

    await runDedupe(
      [freshEntry("a", withOriginalUrl("https://example.com/1"))],
      fakeJobService([]),
      trace
    );

    expect(trace.events).toEqual([]);
  });

  test("the surviving entry of an in-list merge writes no row of its own", async () => {
    const trace = createFakeTraceService();
    const jobs = [
      freshEntry("a", withOriginalUrl("https://example.com/1")),
      freshEntry("b", withOriginalUrl("https://example.com/1")),
    ];

    const result = await runDedupe(jobs, fakeJobService([]), trace);

    const winnerId = result.jobs.find((job) => job.delete_on_save === undefined)?.id;
    expect(trace.events.filter((event) => event.job_id === winnerId)).toEqual([]);
  });
});

// AC 74 and 75. The two in-list reasons are told apart by whether the merged
// job's pooled dates fall less than 24 hours apart.
describe("an entry merged away inside the list", () => {
  test("reads job_abandoned and hard_match_in_list where the dates agree", async () => {
    const trace = createFakeTraceService();
    const jobs = [
      freshEntry("a", { ...withOriginalUrl("https://example.com/1"), posting_date: POSTED_AT }),
      freshEntry("b", { ...withOriginalUrl("https://example.com/1"), posting_date: HOURS_LATER }),
    ];

    await runDedupe(jobs, fakeJobService([]), trace);

    expect(trace.events).toHaveLength(1);
    expect(trace.events[0]?.event).toBe("job_abandoned");
    expect(trace.events[0]?.reason).toBe("hard_match_in_list");
  });

  test("reads repost_match_in_list where the dates are a day or more apart", async () => {
    const trace = createFakeTraceService();
    const jobs = [
      freshEntry("a", { ...withOriginalUrl("https://example.com/1"), posting_date: POSTED_AT }),
      freshEntry("b", { ...withOriginalUrl("https://example.com/1"), posting_date: DAYS_LATER }),
    ];

    await runDedupe(jobs, fakeJobService([]), trace);

    expect(trace.events).toHaveLength(1);
    expect(trace.events[0]?.reason).toBe("repost_match_in_list");
  });
});

// AC 76 to 79. A stored row and the entry that reached it swap places: the
// entry leaves the list and the row joins it.
describe("an entry that left the list for a stored row", () => {
  test("an entry that never held a row reads job_abandoned and matched_db_row", async () => {
    const trace = createFakeTraceService();
    const rows = [storedRow("row-1", withOriginalUrl("https://example.com/1"))];

    await runDedupe(
      [freshEntry("a", withOriginalUrl("https://example.com/1"))],
      fakeJobService(rows),
      trace
    );

    const leaving = trace.events.find((event) => event.job_id === "a");
    expect(leaving?.event).toBe("job_abandoned");
    expect(leaving?.reason).toBe("matched_db_row");
  });

  // Phase 7 AC 68 and 70, superseding the earlier reading. job_abandoned is the
  // word for a job's path through the pipeline ending, and it makes no
  // claim about whether a row existed. Whether a row was actually deleted is
  // save's to say, at the step that carries the delete out, so dedupe saying
  // it here would be guessing at a delete the active-status guardrail can still
  // refuse.
  test("an entry that already held a row reads job_abandoned too", async () => {
    const trace = createFakeTraceService();
    // The stored row is the older of the two, so its id is the one that
    // survives and the entry's own row is the one that goes.
    const rows = [
      storedRow("row-old", {
        ...withOriginalUrl("https://example.com/1"),
        created_at: new Date("2025-06-01T00:00:00.000Z"),
      }),
    ];
    const jobs = [storedRow("row-new", withOriginalUrl("https://example.com/1"))];

    await runDedupe(jobs, fakeJobService(rows), trace);

    const leaving = trace.events.find((event) => event.job_id === "row-new");
    expect(leaving?.event).toBe("job_abandoned");
    expect(leaving?.reason).toBe("matched_db_row");
  });

  test("no dedupe row claims a database row was deleted", async () => {
    const trace = createFakeTraceService();
    const rows = [
      storedRow("row-old", {
        ...withOriginalUrl("https://example.com/1"),
        created_at: new Date("2025-06-01T00:00:00.000Z"),
      }),
    ];
    const jobs = [storedRow("row-new", withOriginalUrl("https://example.com/1"))];

    await runDedupe(jobs, fakeJobService(rows), trace);

    expect(trace.events.map((event) => event.event)).not.toContain("job_dbrow_deleted");
  });

  // AC 78 and 79. That row is the job the event describes, so it supplies
  // both the id and the collector rather than the entry that found it.
  test("the stored row reads job_added_to_list, keyed on itself", async () => {
    const trace = createFakeTraceService();
    const rows = [storedRow("row-1", withOriginalUrl("https://example.com/1"))];

    await runDedupe(
      [freshEntry("a", withOriginalUrl("https://example.com/1"))],
      fakeJobService(rows),
      trace
    );

    const joined = trace.events.find((event) => event.event === "job_added_to_list");
    expect(joined?.reason).toBe("matched_list_entry");
    expect(joined?.job_id).toBe("row-1");
    expect(joined?.collector).toBe("greenhouse");
  });
});

// AC 80 to 83. Those values are what make an over-merge checkable afterwards
// rather than only countable.
describe("what a losing row's detail carries", () => {
  test("names the id the job became and the clause that matched", async () => {
    const trace = createFakeTraceService();
    const rows = [storedRow("row-1", withOriginalUrl("https://example.com/1"))];

    await runDedupe(
      [freshEntry("a", withOriginalUrl("https://example.com/1"))],
      fakeJobService(rows),
      trace
    );

    const detail = detailOf(trace.events.find((event) => event.job_id === "a"));
    expect(detail["became"]).toBe("row-1");
    expect(detail["clause"]).toBe("original_url");
  });

  test("names the clause a company-and-title match fired on", async () => {
    const trace = createFakeTraceService();
    const rows = [
      storedRow("row-1", { company_id: "company-1", title: "Designer", posting_date: POSTED_AT }),
    ];
    const jobs = [
      freshEntry("a", { company_id: "company-1", title: "Designer", posting_date: POSTED_AT }),
    ];

    await runDedupe(jobs, fakeJobService(rows), trace);

    const detail = detailOf(trace.events.find((event) => event.job_id === "a"));
    expect(detail["clause"]).toBe("company_and_title");
  });

  test("names the losing side's company, title, link and posting date", async () => {
    const trace = createFakeTraceService();
    const rows = [storedRow("row-1", withOriginalUrl("https://example.com/1"))];
    const jobs = [
      freshEntry("a", {
        ...withOriginalUrl("https://example.com/1"),
        raw_company_name: "Losing Co",
        title: "Staff Product Designer",
        posting_date: POSTED_AT,
      }),
    ];

    await runDedupe(jobs, fakeJobService(rows), trace);

    const detail = detailOf(trace.events.find((event) => event.job_id === "a"));
    expect(detail["company"]).toBe("Losing Co");
    expect(detail["title"]).toBe("Staff Product Designer");
    expect(detail["original_url"]).toBe("https://example.com/1");
    expect(detail["posting_date"]).toBe(POSTED_AT.toISOString());
  });

  // AC 82. Each fold is one edge, and the chain draws as a flow from those
  // edges, so a middle link naming the final survivor would lose the page.
  test("each row of a chain names its immediate partner", async () => {
    const trace = createFakeTraceService();
    // Three entries chained on one link, folded in two steps.
    const jobs = [
      freshEntry("a", withOriginalUrl("https://example.com/1")),
      freshEntry("b", withOriginalUrl("https://example.com/1")),
      freshEntry("c", withOriginalUrl("https://example.com/1")),
    ];

    const result = await runDedupe(jobs, fakeJobService([]), trace);

    const winnerId = result.jobs.find((job) => job.delete_on_save === undefined)?.id;
    expect(trace.events).toHaveLength(2);
    // The first fold names the partner it met, which is not the entry the
    // chain ended on.
    expect(detailOf(trace.events[0])["became"]).not.toBe(winnerId);
    expect(detailOf(trace.events[1])["became"]).toBe(winnerId);
  });

  // AC 83. A collector bug putting a description in the wrong field must not
  // bloat this table in the run someone needs to read.
  test("cuts every value at 200 characters", async () => {
    const trace = createFakeTraceService();
    const long = "x".repeat(400);
    const rows = [storedRow("row-1", withOriginalUrl("https://example.com/1"))];
    const jobs = [
      freshEntry("a", {
        ...withOriginalUrl("https://example.com/1"),
        raw_company_name: long,
        title: long,
      }),
    ];

    await runDedupe(jobs, fakeJobService(rows), trace);

    const detail = detailOf(trace.events.find((event) => event.job_id === "a"));
    expect(detail["company"]).toHaveLength(200);
    expect(detail["title"]).toHaveLength(200);
  });
});
