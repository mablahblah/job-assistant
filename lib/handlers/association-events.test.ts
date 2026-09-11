import { describe, expect, test } from "vitest";
import { associateCompanies } from "./association";
import { fakeCompanyService } from "../company-service.fake";
import { companyMatchKey } from "../company-match-key";
import type { CompanyRecord } from "../company-service";
import type { JobListEntry } from "../job-list-entry";
import type { TraceEvent, TraceService } from "../trace-service";

// Covers only the trace rows the step writes. What it decides and what it
// warns about keep their own coverage in association.test.ts and are
// not re-asserted here.

const RUN_ID = "run-1";
const STEP = "post_collection_association";

function baseJob(overrides: Partial<JobListEntry> = {}): JobListEntry {
  return { id: "job-1", collector: "adzuna", ...overrides };
}

function namedCompany(id: string, name: string): CompanyRecord {
  return { id, name, match_key: companyMatchKey(name), ats_platform: null, ats_slug: null };
}

function slugCompany(id: string, slug: string): CompanyRecord {
  return { id, name: null, match_key: null, ats_platform: "ashby", ats_slug: slug };
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
    failureCount() {
      return 0;
    },
  };
}

// AC 41 to 45. Every job that came out with a company writes exactly one
// company_associated row for that pass, and its reason says how it got there.
describe("a job that came out with a company", () => {
  test("writes exactly one company_associated row", async () => {
    const trace = createFakeTraceService();
    const companies = fakeCompanyService([slugCompany("c1", "one-row-board")]);

    await associateCompanies([baseJob({ raw_company_slug: "one-row-board" })], {
      companies,
      trace,
      runId: RUN_ID,
      step: STEP,
    });

    const associated = trace.events.filter((event) => event.event === "company_associated");
    expect(associated).toHaveLength(1);
  });

  test("a slug match reads matched_by_slug", async () => {
    const trace = createFakeTraceService();
    const companies = fakeCompanyService([slugCompany("c1", "slug-board")]);

    await associateCompanies([baseJob({ raw_company_slug: "slug-board" })], {
      companies,
      trace,
      runId: RUN_ID,
      step: STEP,
    });

    expect(trace.events[0]?.reason).toBe("matched_by_slug");
  });

  test("a name match reads matched_by_name", async () => {
    const trace = createFakeTraceService();
    const companies = fakeCompanyService([namedCompany("c1", "Named Co")]);

    await associateCompanies([baseJob({ raw_company_name: "Named, Inc." })], {
      companies,
      trace,
      runId: RUN_ID,
      step: STEP,
    });

    expect(trace.events[0]?.reason).toBe("matched_by_name");
  });

  test("a company created for the job reads company_created", async () => {
    const trace = createFakeTraceService();

    await associateCompanies([baseJob({ raw_company_name: "Fresh Co" })], {
      companies: fakeCompanyService(),
      trace,
      runId: RUN_ID,
      step: STEP,
    });

    expect(trace.events[0]?.reason).toBe("company_created");
  });

  // AC 45. Counting company_created rows is how a run reports the companies
  // it added, so a create that was refused must not inflate that figure.
  test("a create the service refused reads as a match, not company_created", async () => {
    const trace = createFakeTraceService();
    const companies = fakeCompanyService([], {
      create: async () => ({ company: namedCompany("blocker", "Blocked Co"), created: false }),
    });

    await associateCompanies([baseJob({ raw_company_name: "Blocked Co" })], {
      companies,
      trace,
      runId: RUN_ID,
      step: STEP,
    });

    expect(trace.events[0]?.reason).toBe("matched_by_name");
  });
});

// AC 46 and 53. Filling an empty name leaves no other record of when the
// name arrived, so the row has to carry it.
describe("filling a company's empty name", () => {
  test("writes a company_updated row reading company_name_filled", async () => {
    const trace = createFakeTraceService();
    const companies = fakeCompanyService([slugCompany("c1", "fill-board")]);

    await associateCompanies(
      [baseJob({ raw_company_slug: "fill-board", raw_company_name: "Filled Name" })],
      { companies, trace, runId: RUN_ID, step: STEP }
    );

    const filled = trace.events.find((event) => event.event === "company_updated");
    expect(filled?.reason).toBe("company_name_filled");
  });

  test("its detail carries the name the company was given", async () => {
    const trace = createFakeTraceService();
    const companies = fakeCompanyService([slugCompany("c1", "detail-board")]);

    await associateCompanies(
      [baseJob({ raw_company_slug: "detail-board", raw_company_name: "Detailed Name" })],
      { companies, trace, runId: RUN_ID, step: STEP }
    );

    const filled = trace.events.find((event) => event.event === "company_updated");
    expect(JSON.stringify(filled?.detail)).toContain("Detailed Name");
  });

  // AC 41 again, from the other side: a fill is its own event and does not
  // replace or duplicate the association row beside it.
  test("the association row is written alongside it, not replaced", async () => {
    const trace = createFakeTraceService();
    const companies = fakeCompanyService([slugCompany("c1", "both-rows-board")]);

    await associateCompanies(
      [baseJob({ raw_company_slug: "both-rows-board", raw_company_name: "Both Rows Co" })],
      { companies, trace, runId: RUN_ID, step: STEP }
    );

    const associated = trace.events.filter((event) => event.event === "company_associated");
    expect(associated).toHaveLength(1);
    expect(trace.events).toHaveLength(2);
  });
});

// AC 47 and 48. The two dead ends. Both warn as well, which is covered in
// association.test.ts.
describe("the two failures", () => {
  test("no name to look up reads association_failed and no_name_for_lookup", async () => {
    const trace = createFakeTraceService();

    await associateCompanies([baseJob({ raw_company_slug: "dead-end-board" })], {
      companies: fakeCompanyService(),
      trace,
      runId: RUN_ID,
      step: STEP,
    });

    expect(trace.events[0]?.event).toBe("association_failed");
    expect(trace.events[0]?.reason).toBe("no_name_for_lookup");
  });

  test("a name clash reads company_update_failed and company_name_clash", async () => {
    const trace = createFakeTraceService();
    const companies = fakeCompanyService([
      namedCompany("holder", "Contested Name"),
      slugCompany("target", "contested-board"),
    ]);

    await associateCompanies(
      [baseJob({ raw_company_slug: "contested-board", raw_company_name: "Contested Name" })],
      { companies, trace, runId: RUN_ID, step: STEP }
    );

    const failed = trace.events.find((event) => event.event === "company_update_failed");
    expect(failed?.reason).toBe("company_name_clash");
  });
});

// AC 22, 23, 49, 50. The contract every handler in lib/handlers/ shares.
describe("the step contract", () => {
  // A step handed no trace context still does its work and stays silent,
  // which is what lets association run outside a job search.
  test("no trace service means no rows and the jobs are still associated", async () => {
    const companies = fakeCompanyService([slugCompany("c1", "silent-board")]);

    const result = await associateCompanies([baseJob({ raw_company_slug: "silent-board" })], {
      companies,
    });

    expect(result.jobs[0]?.company_id).toBe("c1");
  });

  test("no run id means no rows are written", async () => {
    const trace = createFakeTraceService();
    const companies = fakeCompanyService([slugCompany("c1", "no-run-board")]);

    await associateCompanies([baseJob({ raw_company_slug: "no-run-board" })], {
      companies,
      trace,
      step: STEP,
    });

    expect(trace.events).toEqual([]);
  });

  test("no step name means no rows are written", async () => {
    const trace = createFakeTraceService();
    const companies = fakeCompanyService([slugCompany("c1", "no-step-board")]);

    await associateCompanies([baseJob({ raw_company_slug: "no-step-board" })], {
      companies,
      trace,
      runId: RUN_ID,
    });

    expect(trace.events).toEqual([]);
  });

  test("every row carries the run, the step and the collector its caller set", async () => {
    const trace = createFakeTraceService();
    const companies = fakeCompanyService([slugCompany("c1", "stamped-board")]);

    await associateCompanies(
      [baseJob({ collector: "lever", raw_company_slug: "stamped-board" })],
      { companies, trace, runId: RUN_ID, step: STEP }
    );

    expect(trace.events[0]?.run_id).toBe(RUN_ID);
    expect(trace.events[0]?.step).toBe(STEP);
    expect(trace.events[0]?.collector).toBe("lever");
    expect(trace.events[0]?.job_id).toBe("job-1");
  });

  // AC 50. A trace row and a warning are both keyed by job id and collector,
  // so a job carrying neither has nothing to key its record on.
  test("a job with no id writes no row and raises no warning, and is still associated", async () => {
    const trace = createFakeTraceService();
    const companies = fakeCompanyService([slugCompany("c1", "no-id-board")]);
    const jobs: JobListEntry[] = [{ collector: "adzuna", raw_company_slug: "no-id-board" }];

    const result = await associateCompanies(jobs, {
      companies,
      trace,
      runId: RUN_ID,
      step: STEP,
    });

    expect(trace.events).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.jobs[0]?.company_id).toBe("c1");
  });

  test("a job with no collector writes no row and raises no warning", async () => {
    const trace = createFakeTraceService();
    const companies = fakeCompanyService([slugCompany("c1", "no-collector-board")]);
    const jobs: JobListEntry[] = [{ id: "job-9", raw_company_slug: "no-collector-board" }];

    const result = await associateCompanies(jobs, {
      companies,
      trace,
      runId: RUN_ID,
      step: STEP,
    });

    expect(trace.events).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.jobs[0]?.company_id).toBe("c1");
  });

  // AC 49. The longest job title measured is 131 characters and the longest
  // company name 50, so 200 clears every genuine value while still cutting a
  // description a collector bug put in the wrong field.
  test("a detail value longer than 200 characters is cut at 200", async () => {
    const trace = createFakeTraceService();
    const longName = "L".repeat(300);

    await associateCompanies([baseJob({ raw_company_name: longName })], {
      companies: fakeCompanyService(),
      trace,
      runId: RUN_ID,
      step: STEP,
    });

    // The row has to exist first, or "no long value" is true of nothing.
    expect(trace.events).toHaveLength(1);
    const detail = trace.events[0]?.detail;
    const value = typeof detail === "string" ? detail : JSON.stringify(detail ?? "");
    expect(value).toContain("L".repeat(200));
    expect(value).not.toContain("L".repeat(201));
  });
});

// AC 51 and 52. The funnel questions this phase owes the trace table.
describe("what the rows answer on their own", () => {
  test("company_created rows count the companies a run added", async () => {
    const trace = createFakeTraceService();
    const companies = fakeCompanyService([namedCompany("c1", "Already Here")]);
    const jobs = [
      baseJob({ id: "1", raw_company_name: "Already Here" }),
      baseJob({ id: "2", raw_company_name: "Brand New One" }),
      baseJob({ id: "3", raw_company_name: "Brand New Two" }),
    ];

    await associateCompanies(jobs, { companies, trace, runId: RUN_ID, step: STEP });

    const created = trace.events.filter((event) => event.reason === "company_created");
    expect(created).toHaveLength(2);
  });

  test("each job's association row says how that job reached its company", async () => {
    const trace = createFakeTraceService();
    const companies = fakeCompanyService([
      slugCompany("c1", "by-slug-board"),
      namedCompany("c2", "By Name Co"),
    ]);
    const jobs = [
      baseJob({ id: "1", raw_company_slug: "by-slug-board" }),
      baseJob({ id: "2", raw_company_name: "By Name Co" }),
      baseJob({ id: "3", raw_company_name: "By Creation Co" }),
    ];

    await associateCompanies(jobs, { companies, trace, runId: RUN_ID, step: STEP });

    const byJob = new Map(
      trace.events
        .filter((event) => event.event === "company_associated")
        .map((event) => [event.job_id, event.reason])
    );
    expect(byJob.get("1")).toBe("matched_by_slug");
    expect(byJob.get("2")).toBe("matched_by_name");
    expect(byJob.get("3")).toBe("company_created");
  });
});
