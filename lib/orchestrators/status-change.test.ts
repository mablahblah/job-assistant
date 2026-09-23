import { describe, expect, test } from "vitest";
import { runStatusChange, type RunStatusChangeOptions } from "./status-change";
import { fakeJobService } from "../services/job-service.fake";
import { fakeCompanyService, unscoredCompany } from "../services/company-service.fake";
import { fakeWorkLogService } from "../services/work-log-service.fake";
import { fakeCompanySearch, type FakeCompanySearch } from "../tools/company-search.fake";
import type { JobListEntry } from "../types/job-list-entry";
import type { CompanyRecord } from "../services/company-service";
import type { WorkLogRecord } from "../services/work-log-service";

const PRIORITY_LIST = ["collector:greenhouse"];
const IDENTIFYING_QUERY_VALUES = ["opportunityid"];
const COLLECTED_AT = new Date("2026-01-01T00:00:00.000Z");
const NOW = new Date("2026-02-01T00:00:00.000Z");

const FIGMA_QUERY = "Figma headquarters address, phone number, domain url";
const FIGMA_RESULTS = [
  {
    title: "Figma Inc.",
    text: "Headquarters: 760 Market Street, San Francisco, CA 94102. Phone: 415-555-0142. Website: www.figma.com",
  },
];

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

interface Built extends RunStatusChangeOptions {
  jobList: JobListEntry[];
  companyList: CompanyRecord[];
  entries: WorkLogRecord[];
  search: FakeCompanySearch;
}

function build(
  jobList: JobListEntry[] = [backlogJob("job-a")],
  companyList: CompanyRecord[] = [unscoredCompany({ id: "co-1", name: "Figma" })],
  table: Parameters<typeof fakeCompanySearch>[0] = { [FIGMA_QUERY]: FIGMA_RESULTS }
): Built {
  const entries: WorkLogRecord[] = [];
  const search = fakeCompanySearch(table);
  return {
    jobList,
    companyList,
    entries,
    search,
    jobs: fakeJobService(jobList),
    companies: fakeCompanyService(companyList),
    workLog: fakeWorkLogService(entries),
    priorityList: PRIORITY_LIST,
    identifyingQueryValues: IDENTIFYING_QUERY_VALUES,
    now: NOW,
  };
}

describe("one instruction, both halves", () => {
  test("the status is written", async () => {
    const built = build();

    await runStatusChange([{ job_id: "job-a", status: "app. sent" }], built);

    expect(built.jobList[0]?.status).toBe("app. sent");
  });

  test("the work log entry is written", async () => {
    const built = build();

    await runStatusChange([{ job_id: "job-a", status: "app. sent" }], built);

    expect(built.entries).toHaveLength(1);
  });

  test("the employer's contact details are filled in", async () => {
    const built = build();

    await runStatusChange([{ job_id: "job-a", status: "app. sent" }], built);

    expect(built.companyList[0]?.address).toBe("760 Market Street, San Francisco, CA 94102");
  });

  test("both halves come back on the result", async () => {
    const built = build();

    const result = await runStatusChange([{ job_id: "job-a", status: "app. sent" }], built);

    expect(result.changes).toHaveLength(1);
    expect(result.companies).toHaveLength(1);
  });

  test("warnings from both halves come back together", async () => {
    const built = build([backlogJob("job-a")], [unscoredCompany({ id: "co-1", name: "Figma" })], {
      [FIGMA_QUERY]: new Error("the service is down"),
    });

    const result = await runStatusChange([{ job_id: "job-a", status: "app. sent" }], built);

    expect(result.warnings.join(" ")).toContain("Figma");
  });
});

// Criterion 64. The searches are the slow part and the part a time limit can
// cut short, so a run stopped early loses searches and never loses a filing.
describe("every filing is written before the first search starts", () => {
  test("a run whose search never answers still wrote both statuses and both entries", async () => {
    const built = build(
      [backlogJob("job-a"), backlogJob("job-b")],
      [unscoredCompany({ id: "co-1", name: "Figma" })],
      { [FIGMA_QUERY]: new Error("the service is down") }
    );

    await runStatusChange(
      [
        { job_id: "job-a", status: "app. sent" },
        { job_id: "job-b", status: "app. sent" },
      ],
      built
    );

    expect(built.jobList.map((job) => job.status)).toEqual(["app. sent", "app. sent"]);
    expect(built.entries).toHaveLength(2);
  });

  test("the search runs after the writes, not between them", async () => {
    const order: string[] = [];
    const entries: WorkLogRecord[] = [];
    const jobList = [backlogJob("job-a"), backlogJob("job-b")];
    const companyList = [unscoredCompany({ id: "co-1", name: "Figma" })];
    const built: Built = {
      jobList,
      companyList,
      entries,
      search: fakeCompanySearch({}),
      jobs: fakeJobService(jobList),
      companies: fakeCompanyService(companyList),
      workLog: fakeWorkLogService(entries, {
        write: async (entry) => {
          order.push(`entry:${entry.job_id}`);
          return { ...entry, id: entry.job_id, created_at: NOW };
        },
      }),
      priorityList: PRIORITY_LIST,
      identifyingQueryValues: IDENTIFYING_QUERY_VALUES,
      now: NOW,
    };
    built.search = fakeCompanySearch({});
    const watched = built.search;
    built.search = {
      asked: watched.asked,
      async search(query: string) {
        order.push("search");
        return watched.search(query);
      },
    };

    await runStatusChange(
      [
        { job_id: "job-a", status: "app. sent" },
        { job_id: "job-b", status: "app. sent" },
      ],
      built
    );

    expect(order).toEqual(["entry:job-a", "entry:job-b", "search"]);
  });
});

// Only a job whose filing was actually written sends its employer to the
// search. A job set aside for a name, or one that got no entry, has no filing
// for those details to appear on.
describe("which employers are searched", () => {
  test("a status writing no entry sends nobody to the search", async () => {
    const built = build();

    await runStatusChange([{ job_id: "job-a", status: "rejected" }], built);

    expect(built.search.asked).toEqual([]);
  });

  test("a job set aside for an employer name sends nobody to the search", async () => {
    const built = build([backlogJob("job-a", { company_id: null })]);

    await runStatusChange([{ job_id: "job-a", status: "app. sent" }], built);

    expect(built.search.asked).toEqual([]);
  });

  test("a job no row holds sends nobody to the search", async () => {
    const built = build([]);

    await runStatusChange([{ job_id: "ghost", status: "app. sent" }], built);

    expect(built.search.asked).toEqual([]);
  });

  test("the place the job matched reaches the query", async () => {
    const built = build([backlogJob("job-a", { location_match_place: "Austin, TX" })], undefined, {});

    await runStatusChange([{ job_id: "job-a", status: "app. sent" }], built);

    expect(built.search.asked).toEqual([
      "Figma Austin, TX headquarters address, phone number, domain url",
    ]);
  });
});

// Criteria 62 and 63.
describe("a search that fails", () => {
  test("the job's new status still stands", async () => {
    const built = build([backlogJob("job-a")], [unscoredCompany({ id: "co-1", name: "Figma" })], {
      [FIGMA_QUERY]: new Error("down"),
    });

    await runStatusChange([{ job_id: "job-a", status: "app. sent" }], built);

    expect(built.jobList[0]?.status).toBe("app. sent");
  });

  test("the job's work log entry still stands", async () => {
    const built = build([backlogJob("job-a")], [unscoredCompany({ id: "co-1", name: "Figma" })], {
      [FIGMA_QUERY]: new Error("down"),
    });

    await runStatusChange([{ job_id: "job-a", status: "app. sent" }], built);

    expect(built.entries).toHaveLength(1);
  });
});

// A search that found nothing leaves the employer open on purpose, so without
// a guard here ten jobs at one employer nobody can find would be paid for ten
// times in a single run.
describe("one employer named twice in one submission", () => {
  test("is looked up once even when the search finds nothing", async () => {
    const built = build(
      [backlogJob("job-a"), backlogJob("job-b")],
      [unscoredCompany({ id: "co-1", name: "Figma" })],
      {}
    );

    await runStatusChange(
      [
        { job_id: "job-a", status: "app. sent" },
        { job_id: "job-b", status: "app. sent" },
      ],
      built
    );

    expect(built.search.asked).toEqual([FIGMA_QUERY]);
  });

  test("is reported once", async () => {
    const built = build([backlogJob("job-a"), backlogJob("job-b")]);

    const result = await runStatusChange(
      [
        { job_id: "job-a", status: "app. sent" },
        { job_id: "job-b", status: "app. sent" },
      ],
      built
    );

    expect(result.companies).toHaveLength(1);
    expect(result.changes).toHaveLength(2);
  });
});

describe("the identifying query values reach every job write", () => {
  // The real job service rebuilds a job's stored keys on every write, so the
  // list has to arrive intact or UltiPro's opportunityid is stripped out.
  test("the status write is handed the list the runner was given", async () => {
    const built = build();
    const handed: (readonly string[])[] = [];
    const held = built.jobs;
    built.jobs = {
      ...held,
      async update(entry, priorityList, identifyingQueryValues) {
        handed.push(identifyingQueryValues);
        return held.update(entry, priorityList, identifyingQueryValues);
      },
    };

    await runStatusChange([{ job_id: "job-a", status: "won't apply" }], built);

    expect(handed.length).toBeGreaterThan(0);
    for (const list of handed) expect(list).toEqual(IDENTIFYING_QUERY_VALUES);
  });
});
