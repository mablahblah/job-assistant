import { describe, expect, test } from "vitest";
import { runCollection } from "./search-orchestrator";
import type { Collector, CollectorContext, CollectorResult } from "../collectors/types";
import type { JobListEntry } from "../job-list-entry";
import type { SettingsService } from "../settings-service";
import type { TraceEvent, TraceService } from "../trace-service";
import { fakeSettingsService } from "../settings-service.fake";
import { fakeCompanyService } from "../company-service.fake";
import { fakeJobService } from "../job-service.fake";
import type { CompanyRecord } from "../company-service";

// The orchestrator only hands this to collectors, so no getter needs real
// behaviour. It is here to prove it arrives unchanged.
const stubSettings: SettingsService = fakeSettingsService();

// A fixed stand-in for the UUID scripts/collect.ts mints for a real run.
// These are unit tests, so the value is never parsed as a real UUID.
const stubRunId = "test-run-id";

// The date the caller hands over for collected_at. Fixed and clearly not
// today, so a test proving the orchestrator uses the argument rather than a
// clock of its own can tell the two apart.
const stubCollectedAt = new Date("2020-01-02T03:04:05.000Z");


// A minimal job that can still travel: a link, a title, and an employer.
// Every JobListEntry field is optional, but a job carrying none of those three
// is dropped at the end of collection, so the smallest useful job has all of
// them. The title is what tells one job from another here.
function makeJob(title: string): JobListEntry {
  return {
    original_url: `https://example.com/${title}`,
    raw_title: title,
    raw_company_name: "Example",
  };
}

// A stand-in collector that remembers whether it ran and what it was handed,
// so a test can check the orchestrator's side of the contract without mocks.
interface FakeCollector extends Collector {
  wasCalled: boolean;
  contextReceived: CollectorContext | undefined;
}

function makeCollector(name: string, result: CollectorResult): FakeCollector {
  const fake: FakeCollector = {
    name,
    wasCalled: false,
    contextReceived: undefined,
    async collect(context) {
      fake.wasCalled = true;
      fake.contextReceived = context;
      return result;
    },
  };
  return fake;
}

// A collector that fails outright, the way a real one does on a dead request
// or a page that will not load.
function makeThrowingCollector(name: string, message: string): FakeCollector {
  const fake: FakeCollector = {
    name,
    wasCalled: false,
    contextReceived: undefined,
    async collect(context) {
      fake.wasCalled = true;
      fake.contextReceived = context;
      throw new Error(message);
    },
  };
  return fake;
}

// A stand-in trace service that keeps every event it was handed, so a test can
// read them back, and reports whichever failure count the test chooses. Each
// call builds its own events array, so no state carries between tests.
interface FakeTraceService extends TraceService {
  events: TraceEvent[];
}

function makeTraceService(failures = 0): FakeTraceService {
  const events: TraceEvent[] = [];
  return {
    events,
    async write(event) {
      events.push(event);
    },
    failureCount() {
      return failures;
    },
  };
}

const emptyResult: CollectorResult = { jobs: [], errors: [], warnings: [] };

describe("the trace service's failure count reaches the report as traceFailures", () => {
  test("a nonzero failure count from the trace service appears on report.traceFailures", async () => {
    const trace = makeTraceService(3);
    const collector = makeCollector("lever", emptyResult);
    const report = await runCollection({
      jobService: fakeJobService([]),
      collectedAt: stubCollectedAt,
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace,
      collectors: [collector],
    });
    expect(report.traceFailures).toBe(3);
  });

  test("report.traceFailures is 0 when the trace service records no failures", async () => {
    const trace = makeTraceService(0);
    const collector = makeCollector("lever", emptyResult);
    const report = await runCollection({
      jobService: fakeJobService([]),
      collectedAt: stubCollectedAt,
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace,
      collectors: [collector],
    });
    expect(report.traceFailures).toBe(0);
  });
});

// A settings stand-in carrying enough vocabulary for a title to actually
// reshape, so a test can tell a normalized title from an untouched one.
function settingsWithVocabularies(): SettingsService {
  return fakeSettingsService({
    getTitleHeadNouns: async () => ["designer"],
    getTitleLevels: async () => [{ store: "Sr.", match: ["senior"] }],
    getTitleSuffixes: async () => [],
    getTitleRemovalWords: async () => [],
  });
}

describe("a surviving job carries its normalized title, not its raw one", () => {
  test("Senior Designer comes back as Sr. Designer", async () => {
    const collector = makeCollector("lever", {
      jobs: [makeJob("Senior Designer")],
      errors: [],
      warnings: [],
    });
    const report = await runCollection({
      jobService: fakeJobService([]),
      collectedAt: stubCollectedAt,
      companies: fakeCompanyService([]),
      settings: settingsWithVocabularies(),
      runId: stubRunId,
      trace: makeTraceService(),
      collectors: [collector],
    });
    expect(report.jobs[0]?.title).toBe("Sr. Designer");
  });
});

describe("normalization writes its own trace events after collection", () => {
  test("one ordinary job writes two of them", async () => {
    // stubSettings holds no vocabulary, so this job's title finds no job noun
    // and its company name tidies. Two raw fields acted on, two events.
    const trace = makeTraceService();
    const collector = makeCollector("lever", {
      jobs: [makeJob("Designer")],
      errors: [],
      warnings: [],
    });
    await runCollection({ jobService: fakeJobService([]), collectedAt: stubCollectedAt, companies: fakeCompanyService([]), settings: stubSettings, runId: stubRunId, trace, collectors: [collector] });
    const normalization = trace.events.filter(
      (event) => event.step === "post_collection_normalization"
    );
    expect(normalization).toHaveLength(2);
  });

  test("each one shares the job_id of that job's collected event", async () => {
    // What lets one job's whole path be read back as a single journey.
    const trace = makeTraceService();
    const collector = makeCollector("lever", {
      jobs: [makeJob("Designer")],
      errors: [],
      warnings: [],
    });
    await runCollection({ jobService: fakeJobService([]), collectedAt: stubCollectedAt, companies: fakeCompanyService([]), settings: stubSettings, runId: stubRunId, trace, collectors: [collector] });
    const collected = trace.events.find((event) => event.event === "collected");
    const normalization = trace.events.filter(
      (event) => event.step === "post_collection_normalization"
    );
    for (const event of normalization) {
      expect(event.job_id).toBe(collected?.job_id);
    }
  });

  test("each one names the collector that found the job", async () => {
    const trace = makeTraceService();
    const collector = makeCollector("greenhouse", {
      jobs: [makeJob("Designer")],
      errors: [],
      warnings: [],
    });
    await runCollection({ jobService: fakeJobService([]), collectedAt: stubCollectedAt, companies: fakeCompanyService([]), settings: stubSettings, runId: stubRunId, trace, collectors: [collector] });
    const normalization = trace.events.filter(
      (event) => event.step === "post_collection_normalization"
    );
    for (const event of normalization) {
      expect(event.collector).toBe("greenhouse");
    }
  });

  test("a title event carries its reason and the change it made", async () => {
    const trace = makeTraceService();
    const collector = makeCollector("lever", {
      jobs: [makeJob("Senior Designer")],
      errors: [],
      warnings: [],
    });
    await runCollection({
      jobService: fakeJobService([]),
      collectedAt: stubCollectedAt,
      companies: fakeCompanyService([]),
      settings: settingsWithVocabularies(),
      runId: stubRunId,
      trace,
      collectors: [collector],
    });
    const titleEvent = trace.events.find((event) => event.reason === "title_normalized");
    expect(titleEvent?.event).toBe("job_updated");
    expect(titleEvent?.detail).toEqual({ from: "Senior Designer", to: "Sr. Designer" });
  });
});

describe("normalization runs once, after collection finishes, not once per job inside the loop", () => {
  test("every collection event precedes every normalization event", async () => {
    // One job per collector. If normalization runs inside collection's own
    // per-job loop, the two steps interleave: collect job 1, normalize job 1,
    // collect job 2, normalize job 2. Running normalization once over the
    // finished list keeps every collection event ahead of every
    // normalization event, so index order alone proves which happened.
    const trace = makeTraceService();
    const first = makeCollector("lever", { jobs: [makeJob("Designer")], errors: [], warnings: [] });
    const second = makeCollector("greenhouse", { jobs: [makeJob("Researcher")], errors: [], warnings: [] });
    await runCollection({ jobService: fakeJobService([]), collectedAt: stubCollectedAt, companies: fakeCompanyService([]), settings: stubSettings, runId: stubRunId, trace, collectors: [first, second] });

    const collectionIndexes = trace.events
      .map((event, index) => (event.step === "collection" ? index : -1))
      .filter((index) => index !== -1);
    const normalizationIndexes = trace.events
      .map((event, index) => (event.step === "post_collection_normalization" ? index : -1))
      .filter((index) => index !== -1);

    expect(Math.max(...collectionIndexes)).toBeLessThan(Math.min(...normalizationIndexes));

    // The ordering check above would pass vacuously if normalization simply
    // never ran, so this confirms both collectors' jobs actually reached it.
    const normalizingCollectors = new Set(
      trace.events
        .filter((event) => event.step === "post_collection_normalization")
        .map((event) => event.collector)
    );
    expect(normalizingCollectors).toEqual(new Set(["lever", "greenhouse"]));
  });

  test("report.jobs carries each collector's normalized title, in collector order", async () => {
    const first = makeCollector("lever", { jobs: [makeJob("Senior Designer")], errors: [], warnings: [] });
    const second = makeCollector("greenhouse", { jobs: [makeJob("Senior UX Designer")], errors: [], warnings: [] });
    const report = await runCollection({
      jobService: fakeJobService([]),
      collectedAt: stubCollectedAt,
      companies: fakeCompanyService([]),
      settings: settingsWithVocabularies(),
      runId: stubRunId,
      trace: makeTraceService(),
      collectors: [first, second],
    });

    expect(report.jobs.map((job) => job.title)).toEqual(["Sr. Designer", "Sr. UX Designer"]);
  });
});

describe("a job that never reaches the normalizer gets no normalization event", () => {
  test("a job dropped by the usability check writes none", async () => {
    const trace = makeTraceService();
    const collector = makeCollector("lever", {
      jobs: [{ ...makeJob("Researcher"), raw_title: undefined }],
      errors: [],
      warnings: [],
    });
    await runCollection({ jobService: fakeJobService([]), collectedAt: stubCollectedAt, companies: fakeCompanyService([]), settings: stubSettings, runId: stubRunId, trace, collectors: [collector] });
    expect(trace.events.some((event) => event.step === "post_collection_normalization")).toBe(false);
  });

  test("a collector that throws writes none", async () => {
    const trace = makeTraceService();
    const failing = makeThrowingCollector("greenhouse", "board unreachable");
    await runCollection({ jobService: fakeJobService([]), collectedAt: stubCollectedAt, companies: fakeCompanyService([]), settings: stubSettings, runId: stubRunId, trace, collectors: [failing] });
    expect(trace.events.some((event) => event.step === "post_collection_normalization")).toBe(false);
  });
});

describe("unusable fields are reported once at the end of the run", () => {
  test("an unusable work mode gives one folded warning naming its collector", async () => {
    // "flexible" is not a spelling the work mode list recognises, so the
    // whole list comes back unusable.
    const collector = makeCollector("lever", {
      jobs: [{ ...makeJob("Designer"), raw_mode_list: ["flexible"] }],
      errors: [],
      warnings: [],
    });
    const report = await runCollection({
      jobService: fakeJobService([]),
      collectedAt: stubCollectedAt,
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace: makeTraceService(),
      collectors: [collector],
    });
    const folded = report.warnings.filter((issue) => issue.message.includes("work_mode_unusable"));
    expect(folded).toHaveLength(1);
    expect(folded[0]?.collector).toBe("lever");
  });

  test("two collectors with the same problem get a line each", async () => {
    const first = makeCollector("lever", {
      jobs: [{ ...makeJob("Designer"), raw_mode_list: ["flexible"] }],
      errors: [],
      warnings: [],
    });
    const second = makeCollector("greenhouse", {
      jobs: [{ ...makeJob("Writer"), raw_mode_list: ["flexible"] }],
      errors: [],
      warnings: [],
    });
    const report = await runCollection({
      jobService: fakeJobService([]),
      collectedAt: stubCollectedAt,
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace: makeTraceService(),
      collectors: [first, second],
    });
    const folded = report.warnings.filter((issue) => issue.message.includes("work_mode_unusable"));
    expect(folded.map((issue) => issue.collector).sort()).toEqual(["greenhouse", "lever"]);
  });

  test("a run with nothing unusable adds no warning at all", async () => {
    const collector = makeCollector("lever", {
      jobs: [makeJob("Designer")],
      errors: [],
      warnings: [],
    });
    const report = await runCollection({
      jobService: fakeJobService([]),
      collectedAt: stubCollectedAt,
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace: makeTraceService(),
      collectors: [collector],
    });
    expect(report.warnings.some((issue) => issue.message.includes("unusable"))).toBe(false);
  });
});

describe("the title vocabularies come from settings rather than the code", () => {
  test("supplying one head noun changes what the title normalizes to", async () => {
    // A one-word title reads the same whether or not it matched, so this uses
    // a two-part title: unmatched keeps the comma, matched turns the second
    // part into a team.
    const job = { ...makeJob("Growth Designer"), raw_title: "Designer, Growth" };
    const withNoun = fakeSettingsService({ getTitleHeadNouns: async () => ["designer"] });

    const withoutVocabulary = await runCollection({
      jobService: fakeJobService([]),
      collectedAt: stubCollectedAt,
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace: makeTraceService(),
      collectors: [makeCollector("lever", { jobs: [job], errors: [], warnings: [] })],
    });
    const withVocabulary = await runCollection({
      jobService: fakeJobService([]),
      collectedAt: stubCollectedAt,
      companies: fakeCompanyService([]),
      settings: withNoun,
      runId: stubRunId,
      trace: makeTraceService(),
      collectors: [makeCollector("lever", { jobs: [job], errors: [], warnings: [] })],
    });

    expect(withoutVocabulary.jobs[0]?.title).toBe("Designer, Growth");
    expect(withVocabulary.jobs[0]?.title).toBe("Designer - Growth");
  });
});

// AC 24 and AC 25. Association is the step that gives a job the company
// identity dedupe later matches on, so the run has to reach it rather than
// stopping once titles are tidy.
describe("AC 24 and 25: association runs over the surviving list and its warnings reach the report", () => {
  test("a job whose employer is new comes back carrying the company created for it", async () => {
    const companies: CompanyRecord[] = [];
    const job = { ...makeJob("Product Designer"), raw_company_name: "Brightwave Labs" };

    const report = await runCollection({
      settings: stubSettings,
      runId: stubRunId,
      trace: makeTraceService(),
      jobService: fakeJobService([]),
      collectedAt: stubCollectedAt,
      companies: fakeCompanyService(companies),
      collectors: [makeCollector("lever", { jobs: [job], errors: [], warnings: [] })],
    });

    expect(companies).toHaveLength(1);
    expect(report.jobs[0]?.company_id).toBe(companies[0]?.id);
  });

  test("a job whose slug matched nothing and which carries no name warns in the report", async () => {
    const job: JobListEntry = {
      original_url: "https://example.com/unknown-board",
      raw_title: "Product Designer",
      raw_company_slug: "never-polled",
    };

    const report = await runCollection({
      settings: stubSettings,
      runId: stubRunId,
      trace: makeTraceService(),
      jobService: fakeJobService([]),
      collectedAt: stubCollectedAt,
      companies: fakeCompanyService([]),
      collectors: [makeCollector("lever", { jobs: [job], errors: [], warnings: [] })],
    });

    const slugWarnings = report.warnings.filter((warning) =>
      warning.message.includes("never-polled")
    );
    expect(slugWarnings).toHaveLength(1);
    expect(slugWarnings[0]?.collector).toBe("lever");
  });
});

// Normalization tidies raw_company_name before association reads it. If the
// two steps ran in the other order, the company record would be created
// under the raw, untrimmed name instead of the tidied one.
describe("association runs after normalization, on the tidied company name", () => {
  test("a job with a messy company name creates a company holding the tidied name", async () => {
    const companies: CompanyRecord[] = [];
    const job = {
      ...makeJob("Product Designer"),
      raw_company_name: "  Brightwave  Labs, Inc.  ",
    };

    await runCollection({
      settings: stubSettings,
      runId: stubRunId,
      trace: makeTraceService(),
      jobService: fakeJobService([]),
      collectedAt: stubCollectedAt,
      companies: fakeCompanyService(companies),
      collectors: [makeCollector("lever", { jobs: [job], errors: [], warnings: [] })],
    });

    expect(companies).toHaveLength(1);
    // If association ran first, this would still be "  Brightwave  Labs, Inc.  ".
    expect(companies[0]?.name).toBe("Brightwave Labs, Inc");
  });
});

// Association runs once over the combined list from every collector, not
// once per collector, so a job from the second collector must get a company
// id too.
describe("association covers surviving jobs from every collector", () => {
  test("jobs from two different collectors both come back with a company id", async () => {
    const companies: CompanyRecord[] = [];
    const jobA = { ...makeJob("Product Designer"), raw_company_name: "Brightwave Labs" };
    const jobB = { ...makeJob("Backend Engineer"), raw_company_name: "Acme Corp" };

    const report = await runCollection({
      settings: stubSettings,
      runId: stubRunId,
      trace: makeTraceService(),
      jobService: fakeJobService([]),
      collectedAt: stubCollectedAt,
      companies: fakeCompanyService(companies),
      collectors: [
        makeCollector("lever", { jobs: [jobA], errors: [], warnings: [] }),
        makeCollector("greenhouse", { jobs: [jobB], errors: [], warnings: [] }),
      ],
    });

    expect(report.jobs).toHaveLength(2);
    expect(report.jobs[0]?.company_id).toBeTruthy();
    expect(report.jobs[1]?.company_id).toBeTruthy();
    // Two different employers must not collapse onto the same company.
    expect(report.jobs[0]?.company_id).not.toBe(report.jobs[1]?.company_id);
  });
});

// A job missing a link fails the usability check and is dropped before the
// pipeline steps run, so it must never cause a company to be created.
describe("a job dropped for being unusable never reaches the company service", () => {
  test("a job with no link is dropped and creates no company", async () => {
    const companies: CompanyRecord[] = [];
    // job-usable.ts needs a link, a title, and a company name or slug. This
    // job has a title and a company name but no original_url, so it is
    // dropped before normalization or association run.
    const job: JobListEntry = { raw_title: "Product Designer", raw_company_name: "Brightwave Labs" };

    const report = await runCollection({
      settings: stubSettings,
      runId: stubRunId,
      trace: makeTraceService(),
      jobService: fakeJobService([]),
      collectedAt: stubCollectedAt,
      companies: fakeCompanyService(companies),
      collectors: [makeCollector("lever", { jobs: [job], errors: [], warnings: [] })],
    });

    expect(report.jobs).toHaveLength(0);
    expect(companies).toHaveLength(0);
  });
});

// A run capped at zero jobs returns before any collector runs, so no job
// ever reaches the company service either.
describe("a run limited to zero jobs never touches the company service", () => {
  test("limit: 0 skips collection entirely and creates no company", async () => {
    const companies: CompanyRecord[] = [];
    const collector = makeCollector("lever", {
      jobs: [makeJob("Product Designer")],
      errors: [],
      warnings: [],
    });

    const report = await runCollection({
      settings: stubSettings,
      runId: stubRunId,
      trace: makeTraceService(),
      jobService: fakeJobService([]),
      collectedAt: stubCollectedAt,
      companies: fakeCompanyService(companies),
      collectors: [collector],
      limit: 0,
    });

    expect(report.jobs).toHaveLength(0);
    expect(collector.wasCalled).toBe(false);
    expect(companies).toHaveLength(0);
  });
});

// Every trace row association writes must be attributable to the right step
// and the right run, or a query grouped by step would miss the whole pass.
describe("association's trace rows carry the right step name and run id", () => {
  test("association events are stamped post_collection_association with the caller's run id", async () => {
    const companies: CompanyRecord[] = [];
    const trace = makeTraceService();
    const job = { ...makeJob("Product Designer"), raw_company_name: "Brightwave Labs" };

    await runCollection({
      settings: stubSettings,
      runId: stubRunId,
      trace,
      jobService: fakeJobService([]),
      collectedAt: stubCollectedAt,
      companies: fakeCompanyService(companies),
      collectors: [makeCollector("lever", { jobs: [job], errors: [], warnings: [] })],
    });

    const associationEvents = trace.events.filter(
      (event) => event.step === "post_collection_association"
    );
    expect(associationEvents.length).toBeGreaterThan(0);
    expect(associationEvents.every((event) => event.run_id === stubRunId)).toBe(true);
  });
});

// AC 60 to 63. Save is the last step of a collection run, so a run ends in
// database rows rather than a list held in memory.
describe("AC 60: save runs once over the whole surviving list", () => {
  test("every surviving job reaches the job service", async () => {
    const rows: JobListEntry[] = [];
    const collector = makeCollector("greenhouse", {
      jobs: [makeJob("Designer"), makeJob("Researcher")],
      errors: [],
      warnings: [],
    });

    await runCollection({
      jobService: fakeJobService(rows),
      collectedAt: stubCollectedAt,
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace: makeTraceService(),
      collectors: [collector],
    });

    expect(rows.map((row) => row.raw_title).sort()).toEqual(["Designer", "Researcher"]);
  });

  test("jobs from two collectors are saved in one pass, not one pass each", async () => {
    let calls = 0;
    const service = fakeJobService([], {
      async update(entry) {
        calls += 1;
        return { job: entry, outcome: "created" };
      },
    });
    const first = makeCollector("greenhouse", {
      jobs: [makeJob("Designer")],
      errors: [],
      warnings: [],
    });
    const second = makeCollector("lever", { jobs: [makeJob("Writer")], errors: [], warnings: [] });

    await runCollection({
      jobService: service,
      collectedAt: stubCollectedAt,
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace: makeTraceService(),
      collectors: [first, second],
    });

    expect(calls).toBe(2);
  });

  // A job the usability check dropped never became part of the list save is
  // handed, so it must not reach a row.
  test("a job dropped as unusable never reaches the job service", async () => {
    const rows: JobListEntry[] = [];
    const collector = makeCollector("greenhouse", {
      jobs: [makeJob("Designer"), { raw_title: "No Link" }],
      errors: [],
      warnings: [],
    });

    await runCollection({
      jobService: fakeJobService(rows),
      collectedAt: stubCollectedAt,
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace: makeTraceService(),
      collectors: [collector],
    });

    expect(rows.map((row) => row.raw_title)).toEqual(["Designer"]);
  });

  test("a run that collected nothing saves nothing", async () => {
    const rows: JobListEntry[] = [];

    await runCollection({
      jobService: fakeJobService(rows),
      collectedAt: stubCollectedAt,
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace: makeTraceService(),
      collectors: [makeCollector("greenhouse", emptyResult)],
    });

    expect(rows).toEqual([]);
  });
});

describe("AC 61: save's warnings are in the report", () => {
  test("a write that threw is reported as a warning", async () => {
    const service = fakeJobService([], {
      async update() {
        throw new Error("SQLITE_BUSY: database is locked");
      },
    });
    const collector = makeCollector("greenhouse", {
      jobs: [makeJob("Designer")],
      errors: [],
      warnings: [],
    });

    const report = await runCollection({
      jobService: service,
      collectedAt: stubCollectedAt,
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace: makeTraceService(),
      collectors: [collector],
    });

    const saveWarning = report.warnings.find((issue) =>
      issue.message.includes("SQLITE_BUSY: database is locked")
    );
    expect(saveWarning).toBeDefined();
    expect(saveWarning?.collector).toBe("greenhouse");
  });

  test("a run where every write landed raises no save warning", async () => {
    const collector = makeCollector("greenhouse", {
      jobs: [makeJob("Designer")],
      errors: [],
      warnings: [],
    });

    const report = await runCollection({
      jobService: fakeJobService([]),
      collectedAt: stubCollectedAt,
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace: makeTraceService(),
      collectors: [collector],
    });

    expect(report.warnings).toEqual([]);
  });
});

// AC 62. Decision of 2026-09-05: collected_at is stamped by the orchestrator
// on the line beside collector, and is never overwritten once set.
describe("AC 62: collected_at is stamped beside collector", () => {
  test("a saved job carries both the collector and the stamp date", async () => {
    const rows: JobListEntry[] = [];
    const collector = makeCollector("greenhouse", {
      jobs: [makeJob("Designer")],
      errors: [],
      warnings: [],
    });

    await runCollection({
      jobService: fakeJobService(rows),
      collectedAt: stubCollectedAt,
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace: makeTraceService(),
      collectors: [collector],
    });

    expect(rows[0]?.collector).toBe("greenhouse");
    expect(rows[0]?.collected_at).toEqual(stubCollectedAt);
  });

  test("every job in the run takes the same stamp", async () => {
    const rows: JobListEntry[] = [];
    const first = makeCollector("greenhouse", {
      jobs: [makeJob("Designer")],
      errors: [],
      warnings: [],
    });
    const second = makeCollector("lever", { jobs: [makeJob("Writer")], errors: [], warnings: [] });

    await runCollection({
      jobService: fakeJobService(rows),
      collectedAt: stubCollectedAt,
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace: makeTraceService(),
      collectors: [first, second],
    });

    expect(rows.map((row) => row.collected_at)).toEqual([stubCollectedAt, stubCollectedAt]);
  });
});

// AC 63. Taking the date as an argument is what keeps the orchestrator off
// the clock, so a test can pin it and a whole run shares one stamp.
describe("AC 63: the stamp date arrives as an argument", () => {
  test("the date the caller passed is the date that lands, not today's", async () => {
    const rows: JobListEntry[] = [];
    const longAgo = new Date("1999-12-31T23:59:59.000Z");
    const collector = makeCollector("greenhouse", {
      jobs: [makeJob("Designer")],
      errors: [],
      warnings: [],
    });

    await runCollection({
      jobService: fakeJobService(rows),
      collectedAt: longAgo,
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace: makeTraceService(),
      collectors: [collector],
    });

    expect(rows[0]?.collected_at).toEqual(longAgo);
  });
});

// The list ranks the sources a contested field resolves by. The orchestrator
// reads it once for the run and hands it down, the same route the title
// vocabularies already take to the normalizer.
describe("the source priority list reaches save", () => {
  test("the list settings hold is handed to every write", async () => {
    const lists: (readonly string[])[] = [];
    const priorityList = ["collector:user", "collector:greenhouse"];
    const service = fakeJobService([], {
      async update(entry, handed) {
        lists.push(handed);
        return { job: entry, outcome: "created" };
      },
    });
    const collector = makeCollector("greenhouse", {
      jobs: [makeJob("Designer"), makeJob("Researcher")],
      errors: [],
      warnings: [],
    });

    await runCollection({
      jobService: service,
      collectedAt: stubCollectedAt,
      companies: fakeCompanyService([]),
      settings: fakeSettingsService({ getSourcePriorityList: async () => priorityList }),
      runId: stubRunId,
      trace: makeTraceService(),
      collectors: [collector],
    });

    expect(lists).toEqual([priorityList, priorityList]);
  });

  // Read outside every try, like the title vocabularies: a missing setting
  // stops the whole run rather than reading as one collector failing.
  test("a settings service that throws for the list stops the run", async () => {
    const settings = fakeSettingsService({
      getSourcePriorityList: async () => {
        throw new Error("source_priority_list is not set");
      },
    });

    await expect(
      runCollection({
        jobService: fakeJobService([]),
        collectedAt: stubCollectedAt,
        companies: fakeCompanyService([]),
        settings,
        runId: stubRunId,
        trace: makeTraceService(),
        collectors: [makeCollector("greenhouse", emptyResult)],
      })
    ).rejects.toThrow(/source_priority_list/);
  });
});

// AC 72. Dedupe runs between association and save: association gives a job
// the company identity dedupe matches on, and save writes what survives.
describe("dedupe runs after association and before save", () => {
  test("its trace rows are stamped post_collection_dedupe with the caller's run id", async () => {
    const trace = makeTraceService();
    // Two jobs on one link, so the list compare has a match to fold.
    const collector = makeCollector("greenhouse", {
      jobs: [makeJob("Designer"), makeJob("Designer")],
      errors: [],
      warnings: [],
    });

    await runCollection({
      settings: stubSettings,
      runId: stubRunId,
      trace,
      jobService: fakeJobService([]),
      collectedAt: stubCollectedAt,
      companies: fakeCompanyService([]),
      collectors: [collector],
    });

    const dedupeEvents = trace.events.filter((event) => event.step === "post_collection_dedupe");
    expect(dedupeEvents.length).toBeGreaterThan(0);
    expect(dedupeEvents.every((event) => event.run_id === stubRunId)).toBe(true);
  });

  test("only the surviving job reaches the job service as a write", async () => {
    const written: string[] = [];
    const service = fakeJobService([], {
      async update(entry) {
        written.push(entry.id as string);
        return { job: entry, outcome: "created" };
      },
      async delete() {
        return { deleted: false, blockedBy: null };
      },
    });
    const collector = makeCollector("greenhouse", {
      jobs: [makeJob("Designer"), makeJob("Designer")],
      errors: [],
      warnings: [],
    });

    await runCollection({
      settings: stubSettings,
      runId: stubRunId,
      trace: makeTraceService(),
      jobService: service,
      collectedAt: stubCollectedAt,
      companies: fakeCompanyService([]),
      collectors: [collector],
    });

    // The loser is deleted rather than written, so one of the two duplicates
    // reaches the update path.
    expect(written).toHaveLength(1);
  });

  // A step's warnings travel up through its caller, so a lookup that threw
  // reaches the user rather than dying inside the run.
  test("its warnings reach the report", async () => {
    const service = fakeJobService([], {
      async findByOriginalUrlMatchKey() {
        throw new Error("the database went away");
      },
    });

    const report = await runCollection({
      settings: stubSettings,
      runId: stubRunId,
      trace: makeTraceService(),
      jobService: service,
      collectedAt: stubCollectedAt,
      companies: fakeCompanyService([]),
      collectors: [makeCollector("greenhouse", { jobs: [makeJob("Designer")], errors: [], warnings: [] })],
    });

    const lookupWarnings = report.warnings.filter((warning) =>
      warning.message.includes("Database lookup failed")
    );
    expect(lookupWarnings).toHaveLength(1);
  });
});
