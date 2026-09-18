import { describe, expect, test } from "vitest";
import { changeStatuses, type ChangeStatusesOptions } from "./status-change";
import { fakeJobService } from "../services/job-service.fake";
import { fakeCompanyService, unscoredCompany } from "../services/company-service.fake";
import { fakeWorkLogService } from "../services/work-log-service.fake";
import type { JobListEntry } from "../types/job-list-entry";
import type { CompanyRecord } from "../services/company-service";
import type { WorkLogRecord } from "../services/work-log-service";

const PRIORITY_LIST = ["collector:greenhouse", "collector:adzuna"];
const COLLECTED_AT = new Date("2026-01-01T00:00:00.000Z");

function backlogJob(id: string, fields: Partial<JobListEntry> = {}): JobListEntry {
  return {
    id,
    status: "backlog",
    title: "Senior Product Designer",
    company_id: "co-1",
    collected_at: COLLECTED_AT,
    collector: "greenhouse",
    ...fields,
  };
}

interface Built extends ChangeStatusesOptions {
  jobList: JobListEntry[];
  companyList: CompanyRecord[];
  entries: WorkLogRecord[];
}

function build(
  jobList: JobListEntry[] = [],
  companyList: CompanyRecord[] = [unscoredCompany({ id: "co-1", name: "Figma" })],
  entries: WorkLogRecord[] = [],
  overrides: Partial<ChangeStatusesOptions> = {}
): Built {
  return {
    jobList,
    companyList,
    entries,
    jobs: fakeJobService(jobList),
    companies: fakeCompanyService(companyList),
    workLog: fakeWorkLogService(entries),
    priorityList: PRIORITY_LIST,
    ...overrides,
  };
}

// Criteria 1, 2, 6 and 9.
describe("writing the new status", () => {
  test("a backlog job moved to app. sent carries that status", async () => {
    const built = build([backlogJob("job-a")]);

    await changeStatuses([{ job_id: "job-a", status: "app. sent" }], built);

    expect(built.jobList[0]?.status).toBe("app. sent");
  });

  test("an applied job moved to interview carries that status", async () => {
    const built = build([backlogJob("job-a", { status: "app. sent" })]);

    await changeStatuses([{ job_id: "job-a", status: "interview" }], built);

    expect(built.jobList[0]?.status).toBe("interview");
  });

  test("every job in a submission carries its new status", async () => {
    const built = build([backlogJob("job-a"), backlogJob("job-b"), backlogJob("job-c")]);

    await changeStatuses(
      [
        { job_id: "job-a", status: "app. sent" },
        { job_id: "job-b", status: "won't apply" },
        { job_id: "job-c", status: "rejected" },
      ],
      built
    );

    expect(built.jobList.map((job) => job.status)).toEqual([
      "app. sent",
      "won't apply",
      "rejected",
    ]);
  });

  test("every changed job is reported as changed", async () => {
    const built = build([backlogJob("job-a")]);

    const result = await changeStatuses([{ job_id: "job-a", status: "rejected" }], built);

    expect(result.changes).toEqual([
      expect.objectContaining({ job_id: "job-a", status: "rejected", outcome: "changed" }),
    ]);
  });
});

// Criteria 7, 8 and 9. The job service creates a row when asked to update one
// it cannot find, so a mistyped id would otherwise write a junk row under the
// typo. The handler reads the job first and answers for itself.
describe("a job id matching no stored job", () => {
  test("the run reports that no job holds that id", async () => {
    const built = build([]);

    const result = await changeStatuses([{ job_id: "ghost", status: "app. sent" }], built);

    expect(result.changes[0]).toMatchObject({ job_id: "ghost", outcome: "no_such_job" });
  });

  test("no new job row is created", async () => {
    const built = build([]);

    await changeStatuses([{ job_id: "ghost", status: "app. sent" }], built);

    expect(built.jobList).toHaveLength(0);
  });

  test("the rest of the submission still goes through", async () => {
    const built = build([backlogJob("job-a"), backlogJob("job-b"), backlogJob("job-c")]);

    await changeStatuses(
      [
        { job_id: "ghost", status: "app. sent" },
        { job_id: "job-a", status: "app. sent" },
        { job_id: "job-b", status: "app. sent" },
        { job_id: "job-c", status: "app. sent" },
      ],
      built
    );

    expect(built.jobList.map((job) => job.status)).toEqual([
      "app. sent",
      "app. sent",
      "app. sent",
    ]);
  });
});

// Criteria 15, 16, 17 and 18. The trigger is named by status, never by which
// branch the job service took: a job going from backlog to app. sent takes a
// different path from one already applied to, and hanging the entry on that
// branch would skip the first entry for every job.
describe("the work log entry a status writes", () => {
  test.each(["app. sent", "screening", "interview"])("%s writes one entry", async (status) => {
    const built = build([backlogJob("job-a")]);

    await changeStatuses([{ job_id: "job-a", status }], built);

    expect(built.entries).toHaveLength(1);
    expect(built.entries[0]).toMatchObject({ job_id: "job-a" });
  });

  test.each([
    "backlog",
    "expired",
    "too far",
    "won't apply",
    "unresolvable",
    "unparseable",
    "rejected",
    "test",
    "offer",
  ])("%s writes no entry", async (status) => {
    const built = build([backlogJob("job-a")]);

    await changeStatuses([{ job_id: "job-a", status }], built);

    expect(built.entries).toHaveLength(0);
  });

  test("the entry names the activity, the employer and the title", async () => {
    const built = build([backlogJob("job-a")]);

    await changeStatuses([{ job_id: "job-a", status: "screening" }], built);

    expect(built.entries[0]).toMatchObject({
      job_id: "job-a",
      activity: "Had phone screen",
      company_name: "Figma",
      job_title: "Senior Product Designer",
    });
  });

  test("a job that got an entry is reported as having got one", async () => {
    const built = build([backlogJob("job-a")]);

    const result = await changeStatuses([{ job_id: "job-a", status: "app. sent" }], built);

    expect(result.changes[0]).toMatchObject({ entry_written: true });
  });

  test("a job that got no entry is reported as having got none", async () => {
    const built = build([backlogJob("job-a")]);

    const result = await changeStatuses([{ job_id: "job-a", status: "rejected" }], built);

    expect(result.changes[0]).toMatchObject({ entry_written: false });
  });
});

// Criteria 25, 26, 27 and 80.
describe("the title the entry copies", () => {
  test("the tidied title is copied where the job has one", async () => {
    const built = build([backlogJob("job-a", { title: "Senior Designer", raw_title: "Sr Des II" })]);

    await changeStatuses([{ job_id: "job-a", status: "app. sent" }], built);

    expect(built.entries[0]?.job_title).toBe("Senior Designer");
  });

  test("the published title stands in where the tidied one is empty", async () => {
    const built = build([backlogJob("job-a", { title: null, raw_title: "Sr Des II" })]);

    await changeStatuses([{ job_id: "job-a", status: "app. sent" }], built);

    expect(built.entries[0]?.job_title).toBe("Sr Des II");
  });

  test("a job holding neither title gets no entry", async () => {
    const built = build([backlogJob("job-a", { title: null, raw_title: null })]);

    await changeStatuses([{ job_id: "job-a", status: "app. sent" }], built);

    expect(built.entries).toHaveLength(0);
  });

  test("the run states that a job holding neither title got no entry", async () => {
    const built = build([backlogJob("job-a", { title: null, raw_title: null })]);

    const result = await changeStatuses([{ job_id: "job-a", status: "app. sent" }], built);

    expect(result.changes[0]).toMatchObject({ outcome: "no_title", entry_written: false });
  });
});

// Criteria 28, 29 and 31. Nothing can undo either write, so the protection is
// the order plus a failure the user can see and act on.
describe("a work log entry the database refuses", () => {
  function refusing(): Partial<ChangeStatusesOptions> {
    return {
      workLog: fakeWorkLogService([], {
        write: async () => {
          throw new Error("no such table: WorkLogEntry");
        },
      }),
    };
  }

  test("the run states that the entry was not written", async () => {
    const built = build([backlogJob("job-a")], undefined, [], refusing());

    const result = await changeStatuses([{ job_id: "job-a", status: "app. sent" }], built);

    expect(result.changes[0]).toMatchObject({ outcome: "entry_failed", entry_written: false });
  });

  test("the job's new status still stands", async () => {
    const built = build([backlogJob("job-a")], undefined, [], refusing());

    await changeStatuses([{ job_id: "job-a", status: "app. sent" }], built);

    expect(built.jobList[0]?.status).toBe("app. sent");
  });

  test("the failure is raised as a warning naming the job", async () => {
    const built = build([backlogJob("job-a")], undefined, [], refusing());

    const result = await changeStatuses([{ job_id: "job-a", status: "app. sent" }], built);

    expect(result.warnings.join(" ")).toContain("job-a");
  });

  test("a job whose status write fails gets no entry", async () => {
    const built = build([backlogJob("job-a")], undefined, [], {
      jobs: fakeJobService([backlogJob("job-a")], {
        update: async () => {
          throw new Error("the database is locked");
        },
      }),
    });

    const result = await changeStatuses([{ job_id: "job-a", status: "app. sent" }], built);

    expect(built.entries).toHaveLength(0);
    expect(result.changes[0]?.entry_written).toBe(false);
  });
});

// Criteria 32, 33, 34 and 41. Every hiring board the app polls creates an
// employer row holding a slug and no name, so a job attached to one of those
// does carry an employer while the name is still blank.
describe("a job with no usable employer name", () => {
  test("a job linked to no employer is set aside and asked about", async () => {
    const built = build([backlogJob("job-a", { company_id: null })]);

    const result = await changeStatuses([{ job_id: "job-a", status: "app. sent" }], built);

    expect(result.changes[0]).toMatchObject({ outcome: "needs_company_name" });
  });

  test("a job linked to a nameless employer is set aside and asked about", async () => {
    const built = build([backlogJob("job-a", { company_id: "co-blank" })], [
      unscoredCompany({ id: "co-blank" }),
    ]);

    const result = await changeStatuses([{ job_id: "job-a", status: "app. sent" }], built);

    expect(result.changes[0]).toMatchObject({ outcome: "needs_company_name" });
  });

  test("a job set aside is not written", async () => {
    const built = build([backlogJob("job-a", { company_id: null })]);

    await changeStatuses([{ job_id: "job-a", status: "app. sent" }], built);

    expect(built.jobList[0]?.status).toBe("backlog");
    expect(built.entries).toHaveLength(0);
  });

  test("a job whose employer holds a name is never asked about", async () => {
    const built = build([backlogJob("job-a")]);

    const result = await changeStatuses([{ job_id: "job-a", status: "app. sent" }], built);

    expect(result.changes[0]?.outcome).toBe("changed");
  });

  // Only a status that writes an entry needs an employer named, because the
  // asking exists to keep a blank employer off a legal filing.
  test("a status writing no entry goes through with no employer at all", async () => {
    const built = build([backlogJob("job-a", { company_id: null })]);

    await changeStatuses([{ job_id: "job-a", status: "rejected" }], built);

    expect(built.jobList[0]?.status).toBe("rejected");
  });

  test("the rest of the submission is still written", async () => {
    const built = build([
      backlogJob("job-a", { company_id: null }),
      backlogJob("job-b"),
      backlogJob("job-c"),
      backlogJob("job-d"),
    ]);

    await changeStatuses(
      [
        { job_id: "job-a", status: "app. sent" },
        { job_id: "job-b", status: "app. sent" },
        { job_id: "job-c", status: "app. sent" },
        { job_id: "job-d", status: "app. sent" },
      ],
      built
    );

    expect(built.jobList.map((job) => job.status)).toEqual([
      "backlog",
      "app. sent",
      "app. sent",
      "app. sent",
    ]);
  });
});

// Criteria 35, 36, 37, 38, 39, 40 and 71. A nameless employer standing behind
// an aggregator is not one employer, so its other jobs are left where they
// are: they are probably jobs for different companies.
describe("an employer name the user supplied", () => {
  test("a stored employer already holding that name takes the job", async () => {
    const built = build(
      [backlogJob("job-a", { company_id: "co-blank" })],
      [unscoredCompany({ id: "co-blank" }), unscoredCompany({ id: "co-real", name: "Figma" })]
    );

    await changeStatuses(
      [{ job_id: "job-a", status: "app. sent", company_name: "Figma" }],
      built
    );

    expect(built.jobList[0]?.company_id).toBe("co-real");
  });

  test("a name no stored employer holds creates one", async () => {
    const built = build([backlogJob("job-a", { company_id: "co-blank" })], [
      unscoredCompany({ id: "co-blank" }),
    ]);

    await changeStatuses(
      [{ job_id: "job-a", status: "app. sent", company_name: "Brand New Co" }],
      built
    );

    expect(built.companyList.map((company) => company.name)).toContain("Brand New Co");
  });

  test("the job is linked to the newly created employer", async () => {
    const built = build([backlogJob("job-a", { company_id: "co-blank" })], [
      unscoredCompany({ id: "co-blank" }),
    ]);

    await changeStatuses(
      [{ job_id: "job-a", status: "app. sent", company_name: "Brand New Co" }],
      built
    );

    const created = built.companyList.find((company) => company.name === "Brand New Co");
    expect(built.jobList[0]?.company_id).toBe(created?.id);
  });

  test("the entry names the employer the name resolved to", async () => {
    const built = build([backlogJob("job-a", { company_id: "co-blank" })], [
      unscoredCompany({ id: "co-blank" }),
    ]);

    await changeStatuses(
      [{ job_id: "job-a", status: "app. sent", company_name: "Brand New Co" }],
      built
    );

    expect(built.entries[0]?.company_name).toBe("Brand New Co");
  });

  test("the nameless employer still exists, still holding no name", async () => {
    const built = build([backlogJob("job-a", { company_id: "co-blank" })], [
      unscoredCompany({ id: "co-blank" }),
    ]);

    await changeStatuses(
      [{ job_id: "job-a", status: "app. sent", company_name: "Brand New Co" }],
      built
    );

    const blank = built.companyList.find((company) => company.id === "co-blank");
    expect(blank).toBeDefined();
    expect(blank?.name).toBeNull();
  });

  test("other jobs stay linked to the nameless employer", async () => {
    const built = build(
      [backlogJob("job-a", { company_id: "co-blank" }), backlogJob("job-b", { company_id: "co-blank" })],
      [unscoredCompany({ id: "co-blank" })]
    );

    await changeStatuses(
      [{ job_id: "job-a", status: "app. sent", company_name: "Brand New Co" }],
      built
    );

    expect(built.jobList[1]?.company_id).toBe("co-blank");
  });

  test("a job given a name is written and reported as changed", async () => {
    const built = build([backlogJob("job-a", { company_id: "co-blank" })], [
      unscoredCompany({ id: "co-blank" }),
    ]);

    const result = await changeStatuses(
      [{ job_id: "job-a", status: "app. sent", company_name: "Brand New Co" }],
      built
    );

    expect(result.changes[0]?.outcome).toBe("changed");
    expect(built.jobList[0]?.status).toBe("app. sent");
  });
});

// The company behind each change travels back, because the search handler
// runs next and needs to know which employers a run touched.
describe("what the result carries about the employer", () => {
  test("a changed job names the employer it was written against", async () => {
    const built = build([backlogJob("job-a")]);

    const result = await changeStatuses([{ job_id: "job-a", status: "app. sent" }], built);

    expect(result.changes[0]).toMatchObject({ company_id: "co-1", company_name: "Figma" });
  });

  test("a job set aside names no employer", async () => {
    const built = build([backlogJob("job-a", { company_id: null })]);

    const result = await changeStatuses([{ job_id: "job-a", status: "app. sent" }], built);

    expect(result.changes[0]).toMatchObject({ company_id: null, company_name: null });
  });
});

// The place a job's location matched travels back with the change, because
// the search that runs next puts it into the query to tell a common employer
// name apart from another business with the same one.
describe("the matched place the result carries", () => {
  test("a job that matched a place carries it", async () => {
    const built = build([backlogJob("job-a", { location_match_place: "Austin, TX" })]);

    const result = await changeStatuses([{ job_id: "job-a", status: "app. sent" }], built);

    expect(result.changes[0]?.place).toBe("Austin, TX");
  });

  // A job moved straight out of the backlog was never classified, so it
  // matched no place and the search uses the employer name alone.
  test("a job that matched no place carries none", async () => {
    const built = build([backlogJob("job-a")]);

    const result = await changeStatuses([{ job_id: "job-a", status: "app. sent" }], built);

    expect(result.changes[0]?.place).toBeNull();
  });

  test("a job no row holds carries none", async () => {
    const built = build([]);

    const result = await changeStatuses([{ job_id: "ghost", status: "app. sent" }], built);

    expect(result.changes[0]?.place).toBeNull();
  });
});
