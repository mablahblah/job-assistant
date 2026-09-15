import { describe, expect, test } from "vitest";
import { dedupeJobs } from "./dedupe";
import { fakeJobService } from "../services/job-service.fake";
import type { JobService } from "../services/job-service";
import type { JobListEntry } from "../types/job-list-entry";
import type { TraceEvent, TraceService } from "../services/trace-service";

// Covers what the step decides: which entries survive, which are marked away,
// which stored rows join the list, and what it warns about. The trace rows it
// writes are covered in dedupe-events.test.ts and are not re-asserted here.

// Greenhouse outranks adzuna, so a contested field these two both fill goes
// greenhouse's way whichever side it arrived on.
const PRIORITY_LIST = ["collector:greenhouse", "collector:adzuna"];

// Fixed dates, so nothing in these tests depends on when they run.
const COLLECTED_AT = new Date("2026-03-01T00:00:00.000Z");
const POSTED_AT = new Date("2026-02-20T00:00:00.000Z");

// A freshly collected entry: no created_at, because nothing has written it.
function freshEntry(id: string, overrides: JobListEntry = {}): JobListEntry {
  return { id, collector: "adzuna", collected_at: COLLECTED_AT, ...overrides };
}

// A stored row read back out of the table. created_at is what marks a side as
// already holding a row, so every stored row carries one.
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

// A link and the key the job service would have written beside it. The lookup
// reads the key column and the identity rules rebuild the key from the link,
// so a row has to carry both for the two to agree.
function withOriginalUrl(url: string): JobListEntry {
  return { original_url: url, original_url_match_key: url };
}

function withResolvedUrl(url: string): JobListEntry {
  return { resolved_url: url, resolved_url_match_key: url };
}

// Records every event handed to it instead of writing to a database, so a
// test asserts on exactly what the step wrote without spinning up Prisma.
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

// Counts every call so a test can prove which lookups ran and that nothing
// else on the service was touched.
function countingJobService(
  rows: JobListEntry[],
  overrides: Partial<JobService> = {}
): JobService & { calls: string[] } {
  const service = fakeJobService(rows, overrides);
  const calls: string[] = [];
  return {
    calls,
    async update(entry, priorityList) {
      calls.push("update");
      return service.update(entry, priorityList);
    },
    async delete(id) {
      calls.push("delete");
      return service.delete(id);
    },
    async findByOriginalUrlMatchKey(matchKey) {
      calls.push("findByOriginalUrlMatchKey");
      return service.findByOriginalUrlMatchKey(matchKey);
    },
    async findByResolvedUrlMatchKey(matchKey) {
      calls.push("findByResolvedUrlMatchKey");
      return service.findByResolvedUrlMatchKey(matchKey);
    },
    async findByCompanyAndTitle(companyId, title) {
      calls.push("findByCompanyAndTitle");
      return service.findByCompanyAndTitle(companyId, title);
    },
    // The reads the other steps own. Dedupe never calls any of them, which is
    // exactly what the call list is here to prove.
    async findUnresolved() {
      calls.push("findUnresolved");
      return service.findUnresolved();
    },
    async findUnparsed() {
      calls.push("findUnparsed");
      return service.findUnparsed();
    },
    async findBacklog() {
      calls.push("findBacklog");
      return service.findBacklog();
    },
    async findExpiredWithin(thresholdDays, now) {
      calls.push("findExpiredWithin");
      return service.findExpiredWithin(thresholdDays, now);
    },
    async findUnclassified() {
      calls.push("findUnclassified");
      return service.findUnclassified();
    },
    async findNeedingScores() {
      calls.push("findNeedingScores");
      return service.findNeedingScores();
    },
  };
}

// Every test runs the step the same way; only the list and the table change.
function runDedupe(
  jobs: JobListEntry[],
  jobService: JobService,
  extras: { trace?: TraceService; runId?: string; step?: string } = {}
) {
  return dedupeJobs(jobs, {
    jobService,
    priorityList: PRIORITY_LIST,
    collectedAt: COLLECTED_AT,
    ...extras,
  });
}

// The entries the step marked for deletion, which travel on the returned list
// so save can delete the row each one names.
function markedAway(jobs: JobListEntry[]): JobListEntry[] {
  return jobs.filter((job) => job.delete_on_save !== undefined);
}

function survivors(jobs: JobListEntry[]): JobListEntry[] {
  return jobs.filter((job) => job.delete_on_save === undefined);
}

// AC 69. A step takes the whole job list and returns that list along with the
// warnings it raised.
describe("the shape the step returns", () => {
  test("returns every entry it was handed when nothing matches", async () => {
    const jobs = [
      freshEntry("a", withOriginalUrl("https://example.com/1")),
      freshEntry("b", withOriginalUrl("https://example.com/2")),
    ];

    const result = await runDedupe(jobs, countingJobService([]));

    expect(survivors(result.jobs).map((job) => job.id)).toEqual(["a", "b"]);
    expect(markedAway(result.jobs)).toEqual([]);
  });

  test("returns the warnings it raised alongside the jobs", async () => {
    const service = countingJobService([], {
      async findByOriginalUrlMatchKey() {
        throw new Error("the database went away");
      },
    });

    const result = await runDedupe([freshEntry("a", withOriginalUrl("https://x.com/1"))], service);

    expect(result.warnings).toHaveLength(1);
  });

  test("marks the loser of an in-list match rather than dropping it", async () => {
    const jobs = [
      freshEntry("a", withOriginalUrl("https://example.com/1")),
      freshEntry("b", withOriginalUrl("https://example.com/1")),
    ];

    const result = await runDedupe(jobs, countingJobService([]));

    expect(survivors(result.jobs)).toHaveLength(1);
    expect(markedAway(result.jobs)).toHaveLength(1);
  });
});

// AC 60. Collapsing duplicates within the list first means each surviving job
// costs one lookup instead of every duplicate paying for its own.
describe("the order of work", () => {
  test("looks up once for two entries that matched each other", async () => {
    const service = countingJobService([]);
    const jobs = [
      freshEntry("a", withOriginalUrl("https://example.com/1")),
      freshEntry("b", withOriginalUrl("https://example.com/1")),
    ];

    await runDedupe(jobs, service);

    expect(service.calls.filter((call) => call === "findByOriginalUrlMatchKey")).toHaveLength(1);
  });

  // AC 59. Each lookup asks the database a different question, so a row from
  // the first never stops the other two from running.
  test("runs all three lookups even where the first one found a row", async () => {
    const service = countingJobService([
      storedRow("row-1", withOriginalUrl("https://example.com/1")),
    ]);
    const jobs = [
      freshEntry("a", {
        ...withOriginalUrl("https://example.com/1"),
        ...withResolvedUrl("https://boards.example.com/1"),
        company_id: "company-1",
        title: "Product Designer",
      }),
    ];

    await runDedupe(jobs, service);

    expect(service.calls).toContain("findByOriginalUrlMatchKey");
    expect(service.calls).toContain("findByResolvedUrlMatchKey");
    expect(service.calls).toContain("findByCompanyAndTitle");
  });

  // AC 70. Everything the step needs arrives as an argument, so the only
  // database work it does is its own lookups and its tracing.
  test("never writes or deletes through the job service", async () => {
    const service = countingJobService([
      storedRow("row-1", withOriginalUrl("https://example.com/1")),
    ]);

    await runDedupe([freshEntry("a", withOriginalUrl("https://example.com/1"))], service);

    expect(service.calls).not.toContain("update");
    expect(service.calls).not.toContain("delete");
  });
});

// AC 61 to 64. Each surviving entry is looked up, and every row the lookups
// reach folds into one job with it.
describe("the database compare", () => {
  test("folds one stored row in with the entry", async () => {
    const rows = [storedRow("row-1", withOriginalUrl("https://example.com/1"))];
    const jobs = [
      freshEntry("a", { ...withOriginalUrl("https://example.com/1"), raw_title: "Designer" }),
    ];

    const result = await runDedupe(jobs, countingJobService(rows));

    // The stored row already holds a database row, so its id survives and the
    // fresh entry is the side that leaves.
    expect(survivors(result.jobs).map((job) => job.id)).toEqual(["row-1"]);
    expect(markedAway(result.jobs).map((job) => job.id)).toEqual(["a"]);
  });

  test("carries the entry's own work onto the surviving job", async () => {
    const rows = [storedRow("row-1", withOriginalUrl("https://example.com/1"))];
    const jobs = [
      freshEntry("a", {
        ...withOriginalUrl("https://example.com/1"),
        company_id: "company-1",
        title: "Product Designer",
      }),
    ];

    const result = await runDedupe(jobs, countingJobService(rows));

    expect(survivors(result.jobs)[0]?.title).toBe("Product Designer");
    expect(survivors(result.jobs)[0]?.company_id).toBe("company-1");
  });

  // AC 63. Rows that all match the entry are duplicates the run has already
  // proved, so every one of them folds in rather than only the first.
  test("folds every row a lookup returned in with the entry", async () => {
    const rows = [
      storedRow("row-1", withOriginalUrl("https://example.com/1")),
      // Born later, so the older row is the one whose id survives and the
      // outcome does not rest on a tie between two identical birthdays.
      storedRow("row-2", {
        ...withOriginalUrl("https://example.com/1"),
        created_at: new Date("2026-02-01T00:00:00.000Z"),
      }),
    ];
    const jobs = [freshEntry("a", withOriginalUrl("https://example.com/1"))];

    const result = await runDedupe(jobs, countingJobService(rows));

    expect(survivors(result.jobs)).toHaveLength(1);
    expect(markedAway(result.jobs).map((job) => job.id).sort()).toEqual(["a", "row-2"]);
  });

  // AC 63. A link lookup naming one row while a company-and-title lookup
  // names another still folds all of them into one job.
  test("folds rows two different lookups reached into one job", async () => {
    const rows = [
      storedRow("row-link", withOriginalUrl("https://example.com/1")),
      storedRow("row-title", {
        company_id: "company-1",
        title: "Product Designer",
        posting_date: POSTED_AT,
      }),
    ];
    const jobs = [
      freshEntry("a", {
        ...withOriginalUrl("https://example.com/1"),
        company_id: "company-1",
        title: "Product Designer",
        posting_date: POSTED_AT,
      }),
    ];

    const result = await runDedupe(jobs, countingJobService(rows));

    expect(survivors(result.jobs)).toHaveLength(1);
    expect(markedAway(result.jobs)).toHaveLength(2);
  });

  // AC 61. A job list entry is a reference to its row, not a second job
  // standing beside it, so an entry never dedupes against a row on the list.
  test("ignores a stored row whose id already sits on the list", async () => {
    const rows = [storedRow("row-1", withOriginalUrl("https://example.com/1"))];
    const jobs = [storedRow("row-1", withOriginalUrl("https://example.com/1"))];

    const result = await runDedupe(jobs, countingJobService(rows));

    expect(survivors(result.jobs).map((job) => job.id)).toEqual(["row-1"]);
    expect(markedAway(result.jobs)).toEqual([]);
  });

  test("ignores a stored row another entry on the list already holds", async () => {
    const rows = [storedRow("row-1", withOriginalUrl("https://example.com/1"))];
    const jobs = [
      storedRow("row-1", withOriginalUrl("https://example.com/2")),
      freshEntry("a", withOriginalUrl("https://example.com/1")),
    ];

    const result = await runDedupe(jobs, countingJobService(rows));

    expect(markedAway(result.jobs)).toEqual([]);
  });

  // AC 64. Two entries reaching one row through different clauses are the
  // same job through that row, so the second joins the claim already on it.
  test("folds a second entry into the claim already holding a row", async () => {
    const rows = [
      storedRow("row-1", {
        ...withOriginalUrl("https://example.com/1"),
        company_id: "company-1",
        title: "Product Designer",
        posting_date: POSTED_AT,
      }),
    ];
    const jobs = [
      // Reaches the row on its link, and carries a title the second entry
      // does not, so the two never match each other on the list.
      freshEntry("a", {
        ...withOriginalUrl("https://example.com/1"),
        title: "Design Engineer",
      }),
      // Reaches the same row on company and title.
      freshEntry("b", {
        company_id: "company-1",
        title: "Product Designer",
        posting_date: POSTED_AT,
      }),
    ];

    const result = await runDedupe(jobs, countingJobService(rows));

    expect(survivors(result.jobs).map((job) => job.id)).toEqual(["row-1"]);
    expect(markedAway(result.jobs).map((job) => job.id).sort()).toEqual(["a", "b"]);
  });

  // AC 68. Dedupe works on the list it is handed plus one lookup per entry,
  // and never searches the table for two stored rows matching each other.
  test("leaves two matching stored rows alone where no entry reaches them", async () => {
    const rows = [
      storedRow("row-1", withOriginalUrl("https://example.com/1")),
      storedRow("row-2", withOriginalUrl("https://example.com/1")),
    ];
    const jobs = [freshEntry("a", withOriginalUrl("https://example.com/9"))];

    const result = await runDedupe(jobs, countingJobService(rows));

    expect(result.jobs.map((job) => job.id)).toEqual(["a"]);
    expect(rows.map((row) => row.id)).toEqual(["row-1", "row-2"]);
  });
});

// AC 65 to 67. Under-merging leaves a duplicate the user can see and delete,
// while over-merging destroys a job nobody knows is gone.
describe("a lookup that throws", () => {
  test("leaves the entry on the list unchanged", async () => {
    const service = countingJobService([], {
      async findByOriginalUrlMatchKey() {
        throw new Error("the database went away");
      },
    });
    const job = freshEntry("a", { ...withOriginalUrl("https://x.com/1"), raw_title: "Designer" });

    const result = await runDedupe([job], service);

    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.id).toBe("a");
    expect(result.jobs[0]?.delete_on_save).toBeUndefined();
    expect(result.jobs[0]?.raw_title).toBe("Designer");
  });

  // AC 66. The user has to open that exact entry to fix it, so the warning
  // names the job rather than counting how many failed.
  test("warns naming the entry", async () => {
    const service = countingJobService([], {
      async findByOriginalUrlMatchKey() {
        throw new Error("the database went away");
      },
    });
    const jobs = [
      freshEntry("a", {
        ...withOriginalUrl("https://x.com/1"),
        raw_title: "Staff Product Designer",
      }),
    ];

    const result = await runDedupe(jobs, service);

    expect(result.warnings[0]?.message).toContain("Staff Product Designer");
    expect(result.warnings[0]?.message).toContain("the database went away");
    expect(result.warnings[0]?.collector).toBe("adzuna");
  });

  // AC 67. A trace row is analytics, and nothing happened to this job.
  test("writes no trace row", async () => {
    const trace = createFakeTraceService();
    const service = countingJobService([], {
      async findByOriginalUrlMatchKey() {
        throw new Error("the database went away");
      },
    });

    await runDedupe([freshEntry("a", withOriginalUrl("https://x.com/1"))], service, {
      trace,
      runId: "run-1",
      step: "post_collection_dedupe",
    });

    expect(trace.events).toEqual([]);
  });

  test("still compares every other entry", async () => {
    let firstCall = true;
    const service = countingJobService(
      [storedRow("row-1", withOriginalUrl("https://example.com/2"))],
      {
        async findByOriginalUrlMatchKey(matchKey) {
          if (firstCall) {
            firstCall = false;
            throw new Error("the database went away");
          }
          return [storedRow("row-1", withOriginalUrl(matchKey))];
        },
      }
    );
    const jobs = [
      freshEntry("a", withOriginalUrl("https://example.com/1")),
      freshEntry("b", withOriginalUrl("https://example.com/2")),
    ];

    const result = await runDedupe(jobs, service);

    expect(survivors(result.jobs).map((job) => job.id).sort()).toEqual(["a", "row-1"]);
  });
});

// AC 71. The same step runs at more than one point in the pipeline, so it is
// told which run and which pass it is writing for rather than deciding.
describe("the trace it is handed", () => {
  test("takes the run id and the step name from its caller", async () => {
    const trace = createFakeTraceService();
    const jobs = [
      freshEntry("a", withOriginalUrl("https://example.com/1")),
      freshEntry("b", withOriginalUrl("https://example.com/1")),
    ];

    await runDedupe(jobs, countingJobService([]), {
      trace,
      runId: "run-7",
      step: "post_collection_dedupe",
    });

    expect(trace.events[0]?.run_id).toBe("run-7");
    expect(trace.events[0]?.step).toBe("post_collection_dedupe");
  });

  test("does its work and stays silent where no trace was handed in", async () => {
    const jobs = [
      freshEntry("a", withOriginalUrl("https://example.com/1")),
      freshEntry("b", withOriginalUrl("https://example.com/1")),
    ];

    const result = await runDedupe(jobs, countingJobService([]));

    expect(survivors(result.jobs)).toHaveLength(1);
  });
});

// AC 61, 62. Resolution marks a job whose resolution reached a blacklisted host for
// deletion before dedupe ever sees it. mergeJobs never carries delete_on_save
// onto a merged entry, so an entry that won a fold would come out of dedupe
// with its mark gone and its row left standing.
describe("an entry that arrived already marked for deletion", () => {
  // Both entries share a link, so without the set-aside the two would fold
  // into one and whichever won would carry a dedupe reason or none at all.
  function markedAndItsTwin(): JobListEntry[] {
    return [
      freshEntry("blacklisted", {
        ...withOriginalUrl("https://example.com/1"),
        delete_on_save: "blacklisted_url",
      }),
      freshEntry("twin", withOriginalUrl("https://example.com/1")),
    ];
  }

  test("is not folded against another entry that matches it", async () => {
    const result = await runDedupe(markedAndItsTwin(), countingJobService([]));

    expect(result.jobs.map((job) => job.id).sort()).toEqual(["blacklisted", "twin"]);
    expect(survivors(result.jobs).map((job) => job.id)).toEqual(["twin"]);
  });

  test("keeps the reason it arrived with rather than a dedupe reason", async () => {
    const result = await runDedupe(markedAndItsTwin(), countingJobService([]));

    const marked = markedAway(result.jobs);
    expect(marked.map((job) => job.id)).toEqual(["blacklisted"]);
    expect(marked[0]?.delete_on_save).toBe("blacklisted_url");
  });

  test("is not compared against the stored rows either", async () => {
    const jobs = [
      freshEntry("blacklisted", {
        ...withOriginalUrl("https://example.com/1"),
        delete_on_save: "blacklisted_url",
      }),
    ];
    const service = countingJobService([
      storedRow("row-1", withOriginalUrl("https://example.com/1")),
    ]);

    const result = await runDedupe(jobs, service);

    expect(result.jobs.map((job) => job.id)).toEqual(["blacklisted"]);
    expect(service.calls).toEqual([]);
  });

  // Resolution already wrote the row saying this job is leaving. Dedupe did
  // nothing to it, so dedupe has nothing to record.
  test("gets no trace row from dedupe", async () => {
    const trace = createFakeTraceService();

    await runDedupe(markedAndItsTwin(), countingJobService([]), {
      trace,
      runId: "run-1",
      step: "post_resolution_dedupe",
    });

    expect(trace.events.map((event) => event.job_id)).not.toContain("blacklisted");
  });
});
