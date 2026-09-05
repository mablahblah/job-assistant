import { describe, expect, test } from "vitest";
import { associateCompanies } from "./company-association";
import { fakeCompanyService } from "../company-service.fake";
import { companyMatchKey } from "../company-match-key";
import type { CompanyRecord } from "../company-service";
import type { JobListEntry } from "../job-list-entry";

// Covers what the step decides and what it warns about. The trace rows it
// writes are covered in company-association-events.test.ts and are not
// re-asserted here.

function baseJob(overrides: Partial<JobListEntry> = {}): JobListEntry {
  return { id: "job-1", collector: "adzuna", ...overrides };
}

function namedCompany(id: string, name: string): CompanyRecord {
  return {
    id,
    name,
    match_key: companyMatchKey(name),
    ats_platform: null,
    ats_slug: null,
  };
}

function slugCompany(id: string, slug: string): CompanyRecord {
  return { id, name: null, match_key: null, ats_platform: "ashby", ats_slug: slug };
}

// AC 20. A step takes the job list, acts on every entry, and returns that
// list along with the warnings it raised.
describe("the shape the step returns", () => {
  test("returns a list the same length as the one handed in", async () => {
    const jobs = [
      baseJob({ id: "1", raw_company_name: "One" }),
      baseJob({ id: "2", raw_company_name: "Two" }),
      baseJob({ id: "3", raw_company_name: "Three" }),
    ];

    const result = await associateCompanies(jobs, { companies: fakeCompanyService() });

    expect(result.jobs).toHaveLength(3);
  });

  test("returns the warnings it raised alongside the jobs", async () => {
    const jobs = [baseJob({ raw_company_slug: "unknown-board" })];

    const result = await associateCompanies(jobs, { companies: fakeCompanyService() });

    expect(result.warnings).toHaveLength(1);
  });

  test("leaves the job it was handed untouched", async () => {
    const job = baseJob({ raw_company_name: "Untouched Co" });

    const result = await associateCompanies([job], { companies: fakeCompanyService() });

    expect(result.jobs[0]?.company_id).toBeDefined();
    expect(job.company_id).toBeUndefined();
  });
});

// AC 26 to 28. A slug is the stronger identity, because a job carrying one
// has been told which board it came from rather than matched on spelling.
describe("matching by board slug", () => {
  test("a job whose slug a company holds carries that company", async () => {
    const companies = fakeCompanyService([slugCompany("c1", "hinge-health")]);
    const jobs = [baseJob({ raw_company_slug: "hinge-health" })];

    const result = await associateCompanies(jobs, { companies });

    expect(result.jobs[0]?.company_id).toBe("c1");
  });

  // A parser landing on a board the seed never polled must not split an
  // employer the table already holds, so a slug miss falls through.
  test("a slug nobody holds falls through to the name lookup", async () => {
    const companies = fakeCompanyService([namedCompany("c1", "Fallthrough Co")]);
    const jobs = [
      baseJob({ raw_company_slug: "unpolled-board", raw_company_name: "Fallthrough Co" }),
    ];

    const result = await associateCompanies(jobs, { companies });

    expect(result.jobs[0]?.company_id).toBe("c1");
  });

  test("a slug nobody holds and no name leaves the job with no company", async () => {
    const jobs = [baseJob({ raw_company_slug: "unpolled-board" })];

    const result = await associateCompanies(jobs, { companies: fakeCompanyService() });

    expect(result.jobs[0]?.company_id).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
  });
});

// AC 29 to 32. Two spellings of one employer reach one company, and where
// none exists the step creates it.
describe("matching by name, and creating", () => {
  test("a name that keys to a company reaches it without creating one", async () => {
    const stored: CompanyRecord[] = [namedCompany("c1", "Existing Co")];
    const companies = fakeCompanyService(stored);
    const jobs = [baseJob({ raw_company_name: "Existing, Inc." })];

    const result = await associateCompanies(jobs, { companies });

    expect(result.jobs[0]?.company_id).toBe("c1");
    expect(stored).toHaveLength(1);
  });

  test("a name that keys to nothing gets a company of its own", async () => {
    const stored: CompanyRecord[] = [];
    const companies = fakeCompanyService(stored);
    const jobs = [baseJob({ raw_company_name: "Brand New Co" })];

    const result = await associateCompanies(jobs, { companies });

    expect(stored).toHaveLength(1);
    expect(stored[0]?.name).toBe("Brand New Co");
    expect(stored[0]?.match_key).toBe("brandnew");
    expect(result.jobs[0]?.company_id).toBe(stored[0]?.id);
  });

  // AC 31. Ordinary input, not a corner case: two Adzuna results for one
  // employer in one search. The per-job loop is sequential and awaits each
  // call, so the second job finds what the first created.
  test("two jobs naming one absent employer share the company created", async () => {
    const stored: CompanyRecord[] = [];
    const companies = fakeCompanyService(stored);
    const jobs = [
      baseJob({ id: "1", raw_company_name: "Shared Employer" }),
      baseJob({ id: "2", raw_company_name: "Shared Employer, Inc." }),
    ];

    const result = await associateCompanies(jobs, { companies });

    expect(stored).toHaveLength(1);
    expect(result.jobs[0]?.company_id).toBe(result.jobs[1]?.company_id);
  });

  // AC 32. Reachable when two searches run at once. Recovery costs one
  // lookup; letting the error escape would cost the rest of the job list.
  test("a create the service refuses attaches the blocker and raises nothing", async () => {
    const companies = fakeCompanyService([], {
      create: async () => ({ company: namedCompany("blocker", "Blocking Co"), created: false }),
    });
    const jobs = [baseJob({ raw_company_name: "Blocking Co" })];

    const result = await associateCompanies(jobs, { companies });

    expect(result.jobs[0]?.company_id).toBe("blocker");
    expect(result.warnings).toEqual([]);
  });

  // The tidy strips a name of pure punctuation to nothing, so its match key
  // comes out empty. An empty key is no name, and no company is created for
  // it — SQLite treats an empty string as an ordinary value in a unique
  // index, so a second such company would throw rather than merely mismatch.
  test("a name that keys to nothing is treated as no name", async () => {
    const stored: CompanyRecord[] = [];
    let creates = 0;
    const real = fakeCompanyService(stored);
    const companies = fakeCompanyService(stored, {
      create: async (input) => {
        creates += 1;
        return real.create(input);
      },
    });

    const result = await associateCompanies(
      [baseJob({ id: "1", raw_company_name: "-" }), baseJob({ id: "2", raw_company_name: "Real Co" })],
      { companies }
    );

    // The second job proves the counter works, so the first one's zero is a
    // real refusal rather than a create path that never runs.
    expect(creates).toBe(1);
    expect(stored).toHaveLength(1);
    expect(result.jobs[0]?.company_id).toBeUndefined();
    expect(result.jobs[1]?.company_id).toBeDefined();
  });
});

// AC 33 to 36. A company met only as a board slug takes a name from the
// first job that supplies one, and a name it already holds is never
// overwritten.
describe("filling a company's empty name", () => {
  test("a matched company holding no name takes the job's", async () => {
    const stored = [slugCompany("c1", "nameless-board")];
    const companies = fakeCompanyService(stored);
    const jobs = [
      baseJob({ raw_company_slug: "nameless-board", raw_company_name: "Real Name Co" }),
    ];

    await associateCompanies(jobs, { companies });

    expect(stored[0]?.name).toBe("Real Name Co");
    expect(stored[0]?.match_key).toBe("realname");
  });

  // Without this rule a company would log a name change on every run for
  // the rest of its life.
  test("a matched company that already holds a name keeps it", async () => {
    const stored: CompanyRecord[] = [
      { ...slugCompany("c1", "named-board"), name: "Original Name", match_key: "originalname" },
    ];
    const companies = fakeCompanyService(stored);
    const jobs = [baseJob({ raw_company_slug: "named-board", raw_company_name: "Different Name" })];

    const result = await associateCompanies(jobs, { companies });

    expect(result.jobs[0]?.company_id).toBe("c1");
    expect(stored[0]?.name).toBe("Original Name");
  });

  // AC 35. The job still carries the company it matched. Only the name went
  // unwritten, and the clash is reported for the user to merge by hand.
  test("a name another company holds is not written, and the job keeps its company", async () => {
    const stored = [namedCompany("holder", "Taken Name"), slugCompany("target", "target-board")];
    const companies = fakeCompanyService(stored);
    const jobs = [baseJob({ raw_company_slug: "target-board", raw_company_name: "Taken Name" })];

    const result = await associateCompanies(jobs, { companies });

    expect(result.jobs[0]?.company_id).toBe("target");
    expect(stored[1]?.name).toBeNull();
  });

  // AC 36. A company earns being polled by scoring above the graduation
  // threshold, never by being met once.
  test("the company's platform and slug are never written", async () => {
    const stored = [slugCompany("c1", "keeps-its-slug")];
    const companies = fakeCompanyService(stored);
    const jobs = [baseJob({ raw_company_slug: "keeps-its-slug", raw_company_name: "New Name" })];

    await associateCompanies(jobs, { companies });

    expect(stored[0]?.name).toBe("New Name");
    expect(stored[0]?.ats_platform).toBe("ashby");
    expect(stored[0]?.ats_slug).toBe("keeps-its-slug");
  });
});

// AC 38 to 40. The step recomputes on every pass and never skips a job that
// already carries a company, which is what lets parsing correct a company
// the first pass got wrong.
describe("running twice", () => {
  test("unchanged raw fields reach the same company again", async () => {
    const stored = [namedCompany("c1", "Steady Co")];
    let lookups = 0;
    const real = fakeCompanyService(stored);
    const companies = fakeCompanyService(stored, {
      findByMatchKey: async (key) => {
        lookups += 1;
        return real.findByMatchKey(key);
      },
    });
    const job = baseJob({ raw_company_name: "Steady Co", company_id: "c1" });

    const result = await associateCompanies([job], { companies });

    // The lookup has to run. A step that saw company_id already set and
    // skipped the job would never let parsing correct a wrong company.
    expect(lookups).toBe(1);
    expect(result.jobs[0]?.company_id).toBe("c1");
  });

  // Parsing can replace the name collection wrote. The step follows the new
  // name rather than trusting the company already on the job.
  test("a changed company name moves the job to the company that name points at", async () => {
    const companies = fakeCompanyService([
      namedCompany("old", "Wrong Employer"),
      namedCompany("new", "Right Employer"),
    ]);
    const job = baseJob({ raw_company_name: "Right Employer", company_id: "old" });

    const result = await associateCompanies([job], { companies });

    expect(result.jobs[0]?.company_id).toBe("new");
  });

  // AC 40. The step name lands in trace rows and nowhere else. A step that
  // branched on which pass it was running in would be deciding things it is
  // not allowed to know.
  test("the step name it was handed changes no decision", async () => {
    const build = () => fakeCompanyService([slugCompany("c1", "same-board")]);
    const jobs = () => [baseJob({ raw_company_slug: "same-board", raw_company_name: "Same Co" })];

    const first = await associateCompanies(jobs(), {
      companies: build(),
      step: "post_collection_association",
    });
    const second = await associateCompanies(jobs(), {
      companies: build(),
      step: "post_parsing_association",
    });

    expect(first.jobs[0]?.company_id).toBe("c1");
    expect(first.jobs).toEqual(second.jobs);
    expect(first.warnings).toEqual(second.warnings);
  });
});

// AC 54 to 57. A trace row saves and tells nobody; a warning says something
// is wrong the user needs to act on.
describe("the warnings it raises", () => {
  // AC 54. A board worth polling becomes visible instead of quietly
  // producing jobs with no employer.
  test("a slug that matched nothing with no name to fall back on warns", async () => {
    const jobs = [
      baseJob({ collector: "greenhouse", raw_company_slug: "silent-board" }),
    ];

    const result = await associateCompanies(jobs, { companies: fakeCompanyService() });

    expect(result.warnings[0]?.collector).toBe("greenhouse");
    expect(result.warnings[0]?.message).toContain("silent-board");
  });

  // AC 55. A clash is a fact about two company rows, so the user needs both
  // of them to merge the pair by hand.
  test("a name that could not be written names both companies", async () => {
    const companies = fakeCompanyService([
      namedCompany("holder", "Clashing Name"),
      slugCompany("target", "clash-board"),
    ]);
    const jobs = [baseJob({ raw_company_slug: "clash-board", raw_company_name: "Clashing Name" })];

    const result = await associateCompanies(jobs, { companies });

    expect(result.warnings[0]?.message).toContain("Clashing Name");
    expect(result.warnings[0]?.message).toContain("target");
    expect(result.warnings[0]?.message).toContain("holder");
  });

  // AC 56. Folded into a count, a clash tells the user nothing they can act
  // on.
  test("several clashes in one run are several lines", async () => {
    const companies = fakeCompanyService([
      namedCompany("h1", "First Taken"),
      namedCompany("h2", "Second Taken"),
      slugCompany("t1", "board-one"),
      slugCompany("t2", "board-two"),
    ]);
    const jobs = [
      baseJob({ id: "1", raw_company_slug: "board-one", raw_company_name: "First Taken" }),
      baseJob({ id: "2", raw_company_slug: "board-two", raw_company_name: "Second Taken" }),
    ];

    const result = await associateCompanies(jobs, { companies });

    expect(result.warnings).toHaveLength(2);
  });

  // AC 57. The three ordinary outcomes are the step working, so none of them
  // reaches the user.
  test("a match by slug, a match by name, and a create all stay silent", async () => {
    const companies = fakeCompanyService([
      slugCompany("c1", "quiet-board"),
      namedCompany("c2", "Quiet Co"),
    ]);
    const jobs = [
      baseJob({ id: "1", raw_company_slug: "quiet-board" }),
      baseJob({ id: "2", raw_company_name: "Quiet Co" }),
      baseJob({ id: "3", raw_company_name: "Newly Created Co" }),
    ];

    const result = await associateCompanies(jobs, { companies });

    expect(result.jobs.map((job) => job.company_id).filter(Boolean)).toHaveLength(3);
    expect(result.warnings).toEqual([]);
  });
});
