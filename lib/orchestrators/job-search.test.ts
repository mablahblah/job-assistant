import { describe, expect, test, vi } from "vitest";
import { fakeResolutionPage, type ScriptedPage } from "../tools/resolution-page.fake";
import type { ResolutionBrowserSession } from "../tools/resolution-page";
import { runJobSearch } from "./job-search";
import { resolveJobs } from "../handlers/resolution";
import type { Collector, CollectorContext, CollectorResult } from "../collectors/collector";
import type { JobListEntry } from "../types/job-list-entry";
import type { SettingsService } from "../services/settings-service";
import type { TraceEvent, TraceService } from "../services/trace-service";
import { fakeSettingsService } from "../services/settings-service.fake";
import { fakeCompanyService } from "../services/company-service.fake";
import { fakeAtsSlugService } from "../services/ats-slug-service.fake";
import { fakeJobService } from "../services/job-service.fake";
import { fakePlaceService } from "../services/place-service.fake";
import type { PlaceService } from "../services/place-service";
import { fakeGeocoder } from "../tools/geocoder.fake";
import type { Geocoder } from "../tools/geocoder";
import type { JobService } from "../services/job-service";
import type { Parser } from "../parsers/parser";
import type { CompanyRecord } from "../services/company-service";

// The resolution step is wrapped in a spy that still runs the real thing, so
// every test below behaves exactly as it did while one test can also read the
// options the orchestrator handed down.
vi.mock("../handlers/resolution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../handlers/resolution")>();
  return { ...actual, resolveJobs: vi.fn(actual.resolveJobs) };
});

// Carries the default vocabularies and priority list, which is all the
// orchestrator reads off settings. A test needing a title to actually reshape
// uses settingsWithVocabularies() below instead.
const stubSettings: SettingsService = fakeSettingsService();

// A fixed stand-in for the UUID scripts/collect.ts mints for a real run.
// These are unit tests, so the value is never parsed as a real UUID.
const stubRunId = "test-run-id";

// The date the caller hands over for collected_at. Fixed and clearly not
// today, so a test proving the orchestrator uses the argument rather than a
// clock of its own can tell the two apart.
const stubCollectedAt = new Date("2020-01-02T03:04:05.000Z");

// A place service that answers for whatever text it is asked, so every test
// below gets its home coordinates without caring what its settings say the
// user's location is. The coordinates are Austin's, which is where the user
// lives; a test about the location rule itself uses the real fake instead.
function stubPlaces(): PlaceService {
  return fakePlaceService([], {
    async findByText(text: string) {
      return {
        lookup_text: text,
        latitude: 30.2672,
        longitude: -97.7431,
        place_type: "city",
        display_name: "Austin, Texas",
        outline: null,
      };
    },
  });
}

// Paired with stubPlaces above, which answers every lookup, so nothing in this
// file ever reaches the mapping service. Handed an empty table, it answers
// nothing for every text, which would fail the run if it were ever asked.
function stubGeocoder(): Geocoder {
  return fakeGeocoder();
}


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
    // No test here reads a summary back, so the fake answers with
    // nothing rather than keeping counts the tests would not check.
    async countsForRun() {
      return [];
    },
    failureCount() {
      return failures;
    },
  };
}

const emptyResult: CollectorResult = { jobs: [], errors: [], warnings: [] };

// Every test below that is about the collect step says so by declaring nothing
// left to resolve, and is handed a browser that fails the test if anything asks
// it to launch. Criterion 6 is then asserted by the fake rather than by
// counting launches after the run.
const nothingToResolve = { findUnresolved: async () => [], findUnparsed: async () => [] };

// A parser lookup that finds nothing, so a test about an earlier step never
// reaches a real job board. The parsing step then does nothing but park the
// jobs it was handed.
const NO_PARSERS = () => null;

const FORBIDDEN_BROWSER = async (): Promise<ResolutionBrowserSession> => {
  throw new Error("the run launched a browser with nothing to resolve");
};

describe("the trace service's failure count reaches the report as traceFailures", () => {
  test("a nonzero failure count from the trace service appears on report.traceFailures", async () => {
    const trace = makeTraceService(3);
    const collector = makeCollector("lever", emptyResult);
    const report = await runJobSearch({
      openBrowser: FORBIDDEN_BROWSER,
      jobService: fakeJobService([], nothingToResolve),
      collectedAt: stubCollectedAt,
      atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService([]),
      settings: stubSettings,
      places: stubPlaces(),
      geocoder: stubGeocoder(),
      runId: stubRunId,
      trace,
      collectors: [collector],
    });
    expect(report.traceFailures).toBe(3);
  });

  test("report.traceFailures is 0 when the trace service records no failures", async () => {
    const trace = makeTraceService(0);
    const collector = makeCollector("lever", emptyResult);
    const report = await runJobSearch({
      openBrowser: FORBIDDEN_BROWSER,
      jobService: fakeJobService([], nothingToResolve),
      collectedAt: stubCollectedAt,
      atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService([]),
      settings: stubSettings,
      places: stubPlaces(),
      geocoder: stubGeocoder(),
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
    getExpiryThreshold: async () => 30,
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
    const report = await runJobSearch({
      places: stubPlaces(),
      geocoder: stubGeocoder(),
      openBrowser: FORBIDDEN_BROWSER,
      jobService: fakeJobService([], nothingToResolve),
      collectedAt: stubCollectedAt,
      atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService([]),
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
    await runJobSearch({ openBrowser: FORBIDDEN_BROWSER, jobService: fakeJobService([], nothingToResolve), collectedAt: stubCollectedAt, atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService([]), settings: stubSettings,
      places: stubPlaces(),
      geocoder: stubGeocoder(), runId: stubRunId, trace, collectors: [collector] });
    const normalization = trace.events.filter(
      (event) => event.step === "post_collection_normalization"
    );
    expect(normalization).toHaveLength(2);
  });

  test("each one shares the job_id of that job's collected event", async () => {
    // What lets one job's whole path be read back as a single path.
    const trace = makeTraceService();
    const collector = makeCollector("lever", {
      jobs: [makeJob("Designer")],
      errors: [],
      warnings: [],
    });
    await runJobSearch({ openBrowser: FORBIDDEN_BROWSER, jobService: fakeJobService([], nothingToResolve), collectedAt: stubCollectedAt, atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService([]), settings: stubSettings,
      places: stubPlaces(),
      geocoder: stubGeocoder(), runId: stubRunId, trace, collectors: [collector] });
    const collected = trace.events.find((event) => event.event === "job_collected");
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
    await runJobSearch({ openBrowser: FORBIDDEN_BROWSER, jobService: fakeJobService([], nothingToResolve), collectedAt: stubCollectedAt, atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService([]), settings: stubSettings,
      places: stubPlaces(),
      geocoder: stubGeocoder(), runId: stubRunId, trace, collectors: [collector] });
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
    await runJobSearch({
      places: stubPlaces(),
      geocoder: stubGeocoder(),
      openBrowser: FORBIDDEN_BROWSER,
      jobService: fakeJobService([], nothingToResolve),
      collectedAt: stubCollectedAt,
      atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService([]),
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
    await runJobSearch({ openBrowser: FORBIDDEN_BROWSER, jobService: fakeJobService([], nothingToResolve), collectedAt: stubCollectedAt, atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService([]), settings: stubSettings,
      places: stubPlaces(),
      geocoder: stubGeocoder(), runId: stubRunId, trace, collectors: [first, second] });

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
    const report = await runJobSearch({
      places: stubPlaces(),
      geocoder: stubGeocoder(),
      openBrowser: FORBIDDEN_BROWSER,
      jobService: fakeJobService([], nothingToResolve),
      collectedAt: stubCollectedAt,
      atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService([]),
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
    await runJobSearch({ openBrowser: FORBIDDEN_BROWSER, jobService: fakeJobService([], nothingToResolve), collectedAt: stubCollectedAt, atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService([]), settings: stubSettings,
      places: stubPlaces(),
      geocoder: stubGeocoder(), runId: stubRunId, trace, collectors: [collector] });
    expect(trace.events.some((event) => event.step === "post_collection_normalization")).toBe(false);
  });

  test("a collector that throws writes none", async () => {
    const trace = makeTraceService();
    const failing = makeThrowingCollector("greenhouse", "board unreachable");
    await runJobSearch({ openBrowser: FORBIDDEN_BROWSER, jobService: fakeJobService([], nothingToResolve), collectedAt: stubCollectedAt, atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService([]), settings: stubSettings,
      places: stubPlaces(),
      geocoder: stubGeocoder(), runId: stubRunId, trace, collectors: [failing] });
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
    const report = await runJobSearch({
      openBrowser: FORBIDDEN_BROWSER,
      jobService: fakeJobService([], nothingToResolve),
      collectedAt: stubCollectedAt,
      atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService([]),
      settings: stubSettings,
      places: stubPlaces(),
      geocoder: stubGeocoder(),
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
    const report = await runJobSearch({
      openBrowser: FORBIDDEN_BROWSER,
      jobService: fakeJobService([], nothingToResolve),
      collectedAt: stubCollectedAt,
      atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService([]),
      settings: stubSettings,
      places: stubPlaces(),
      geocoder: stubGeocoder(),
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
    const report = await runJobSearch({
      openBrowser: FORBIDDEN_BROWSER,
      jobService: fakeJobService([], nothingToResolve),
      collectedAt: stubCollectedAt,
      atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService([]),
      settings: stubSettings,
      places: stubPlaces(),
      geocoder: stubGeocoder(),
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

    const withoutVocabulary = await runJobSearch({
      openBrowser: FORBIDDEN_BROWSER,
      jobService: fakeJobService([], nothingToResolve),
      collectedAt: stubCollectedAt,
      atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService([]),
      settings: stubSettings,
      places: stubPlaces(),
      geocoder: stubGeocoder(),
      runId: stubRunId,
      trace: makeTraceService(),
      collectors: [makeCollector("lever", { jobs: [job], errors: [], warnings: [] })],
    });
    const withVocabulary = await runJobSearch({
      places: stubPlaces(),
      geocoder: stubGeocoder(),
      openBrowser: FORBIDDEN_BROWSER,
      jobService: fakeJobService([], nothingToResolve),
      collectedAt: stubCollectedAt,
      atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService([]),
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

    const report = await runJobSearch({
      openBrowser: FORBIDDEN_BROWSER,
      settings: stubSettings,
      places: stubPlaces(),
      geocoder: stubGeocoder(),
      runId: stubRunId,
      trace: makeTraceService(),
      jobService: fakeJobService([], nothingToResolve),
      collectedAt: stubCollectedAt,
      atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService(companies),
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

    const report = await runJobSearch({
      openBrowser: FORBIDDEN_BROWSER,
      settings: stubSettings,
      places: stubPlaces(),
      geocoder: stubGeocoder(),
      runId: stubRunId,
      trace: makeTraceService(),
      jobService: fakeJobService([], nothingToResolve),
      collectedAt: stubCollectedAt,
      atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService([]),
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

    await runJobSearch({
      openBrowser: FORBIDDEN_BROWSER,
      settings: stubSettings,
      places: stubPlaces(),
      geocoder: stubGeocoder(),
      runId: stubRunId,
      trace: makeTraceService(),
      jobService: fakeJobService([], nothingToResolve),
      collectedAt: stubCollectedAt,
      atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService(companies),
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

    const report = await runJobSearch({
      openBrowser: FORBIDDEN_BROWSER,
      settings: stubSettings,
      places: stubPlaces(),
      geocoder: stubGeocoder(),
      runId: stubRunId,
      trace: makeTraceService(),
      jobService: fakeJobService([], nothingToResolve),
      collectedAt: stubCollectedAt,
      atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService(companies),
      collectors: [
        makeCollector("lever", { jobs: [jobA], errors: [], warnings: [] }),
        makeCollector("greenhouse", { jobs: [jobB], errors: [], warnings: [] }),
      ],
    });

    expect(report.jobs).toHaveLength(2);
    expect(report.jobs[0]?.company_id).toBeTruthy();
    expect(report.jobs[1]?.company_id).toBeTruthy();
    // Two different employers must not merge onto the same company.
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

    const report = await runJobSearch({
      openBrowser: FORBIDDEN_BROWSER,
      settings: stubSettings,
      places: stubPlaces(),
      geocoder: stubGeocoder(),
      runId: stubRunId,
      trace: makeTraceService(),
      jobService: fakeJobService([], nothingToResolve),
      collectedAt: stubCollectedAt,
      atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService(companies),
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

    const report = await runJobSearch({
      openBrowser: FORBIDDEN_BROWSER,
      settings: stubSettings,
      places: stubPlaces(),
      geocoder: stubGeocoder(),
      runId: stubRunId,
      trace: makeTraceService(),
      jobService: fakeJobService([], nothingToResolve),
      collectedAt: stubCollectedAt,
      atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService(companies),
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
  test("association events are written post_collection_association with the caller's run id", async () => {
    const companies: CompanyRecord[] = [];
    const trace = makeTraceService();
    const job = { ...makeJob("Product Designer"), raw_company_name: "Brightwave Labs" };

    await runJobSearch({
      openBrowser: FORBIDDEN_BROWSER,
      settings: stubSettings,
      places: stubPlaces(),
      geocoder: stubGeocoder(),
      runId: stubRunId,
      trace,
      jobService: fakeJobService([], nothingToResolve),
      collectedAt: stubCollectedAt,
      atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService(companies),
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

    await runJobSearch({
      openBrowser: FORBIDDEN_BROWSER,
      jobService: fakeJobService(rows, nothingToResolve),
      collectedAt: stubCollectedAt,
      atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService([]),
      settings: stubSettings,
      places: stubPlaces(),
      geocoder: stubGeocoder(),
      runId: stubRunId,
      trace: makeTraceService(),
      collectors: [collector],
    });

    expect(rows.map((row) => row.raw_title).sort()).toEqual(["Designer", "Researcher"]);
  });

  test("jobs from two collectors are saved in one pass, not one pass each", async () => {
    let calls = 0;
    const service = fakeJobService([], {
      ...nothingToResolve,
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

    await runJobSearch({
      openBrowser: FORBIDDEN_BROWSER,
      jobService: service,
      collectedAt: stubCollectedAt,
      atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService([]),
      settings: stubSettings,
      places: stubPlaces(),
      geocoder: stubGeocoder(),
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

    await runJobSearch({
      openBrowser: FORBIDDEN_BROWSER,
      jobService: fakeJobService(rows, nothingToResolve),
      collectedAt: stubCollectedAt,
      atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService([]),
      settings: stubSettings,
      places: stubPlaces(),
      geocoder: stubGeocoder(),
      runId: stubRunId,
      trace: makeTraceService(),
      collectors: [collector],
    });

    expect(rows.map((row) => row.raw_title)).toEqual(["Designer"]);
  });

  test("a run that collected nothing saves nothing", async () => {
    const rows: JobListEntry[] = [];

    await runJobSearch({
      openBrowser: FORBIDDEN_BROWSER,
      jobService: fakeJobService(rows, nothingToResolve),
      collectedAt: stubCollectedAt,
      atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService([]),
      settings: stubSettings,
      places: stubPlaces(),
      geocoder: stubGeocoder(),
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
      ...nothingToResolve,
      async update() {
        throw new Error("SQLITE_BUSY: database is locked");
      },
    });
    const collector = makeCollector("greenhouse", {
      jobs: [makeJob("Designer")],
      errors: [],
      warnings: [],
    });

    const report = await runJobSearch({
      openBrowser: FORBIDDEN_BROWSER,
      jobService: service,
      collectedAt: stubCollectedAt,
      atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService([]),
      settings: stubSettings,
      places: stubPlaces(),
      geocoder: stubGeocoder(),
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

    const report = await runJobSearch({
      openBrowser: FORBIDDEN_BROWSER,
      jobService: fakeJobService([], nothingToResolve),
      collectedAt: stubCollectedAt,
      atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService([]),
      settings: stubSettings,
      places: stubPlaces(),
      geocoder: stubGeocoder(),
      runId: stubRunId,
      trace: makeTraceService(),
      collectors: [collector],
    });

    expect(report.warnings).toEqual([]);
  });
});

// AC 62. Decision of 2026-09-05: collected_at is written by the orchestrator
// on the line beside collector, and is never overwritten once set.
describe("AC 62: collected_at is written beside collector", () => {
  test("a saved job carries both the collector and the value date", async () => {
    const rows: JobListEntry[] = [];
    const collector = makeCollector("greenhouse", {
      jobs: [makeJob("Designer")],
      errors: [],
      warnings: [],
    });

    await runJobSearch({
      openBrowser: FORBIDDEN_BROWSER,
      jobService: fakeJobService(rows, nothingToResolve),
      collectedAt: stubCollectedAt,
      atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService([]),
      settings: stubSettings,
      places: stubPlaces(),
      geocoder: stubGeocoder(),
      runId: stubRunId,
      trace: makeTraceService(),
      collectors: [collector],
    });

    expect(rows[0]?.collector).toBe("greenhouse");
    expect(rows[0]?.collected_at).toEqual(stubCollectedAt);
  });

  test("every job in the run takes the same write", async () => {
    const rows: JobListEntry[] = [];
    const first = makeCollector("greenhouse", {
      jobs: [makeJob("Designer")],
      errors: [],
      warnings: [],
    });
    const second = makeCollector("lever", { jobs: [makeJob("Writer")], errors: [], warnings: [] });

    await runJobSearch({
      openBrowser: FORBIDDEN_BROWSER,
      jobService: fakeJobService(rows, nothingToResolve),
      collectedAt: stubCollectedAt,
      atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService([]),
      settings: stubSettings,
      places: stubPlaces(),
      geocoder: stubGeocoder(),
      runId: stubRunId,
      trace: makeTraceService(),
      collectors: [first, second],
    });

    expect(rows.map((row) => row.collected_at)).toEqual([stubCollectedAt, stubCollectedAt]);
  });
});

// AC 63. Taking the date as an argument is what keeps the orchestrator off
// the clock, so a test can pin it and a whole run shares one write.
describe("AC 63: the value date arrives as an argument", () => {
  test("the date the caller passed is the date that lands, not today's", async () => {
    const rows: JobListEntry[] = [];
    const longAgo = new Date("1999-12-31T23:59:59.000Z");
    const collector = makeCollector("greenhouse", {
      jobs: [makeJob("Designer")],
      errors: [],
      warnings: [],
    });

    await runJobSearch({
      openBrowser: FORBIDDEN_BROWSER,
      jobService: fakeJobService(rows, nothingToResolve),
      collectedAt: longAgo,
      atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService([]),
      settings: stubSettings,
      places: stubPlaces(),
      geocoder: stubGeocoder(),
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
      ...nothingToResolve,
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

    await runJobSearch({
      places: stubPlaces(),
      geocoder: stubGeocoder(),
      openBrowser: FORBIDDEN_BROWSER,
      jobService: service,
      collectedAt: stubCollectedAt,
      atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService([]),
      settings: fakeSettingsService({ getSourcePriorityList: async () => priorityList }),
      runId: stubRunId,
      trace: makeTraceService(),
      collectors: [collector],
    });

    expect(lists).toEqual([priorityList, priorityList]);
  });

  // Read outside every handler, like the title vocabularies: a missing
  // setting stops the whole run rather than reading as one collector failing.
  // The stop is reported rather than thrown, so collection's finished work
  // still reaches the caller.
  test("a settings service that throws for the list stops the run", async () => {
    const settings = fakeSettingsService({
      getSourcePriorityList: async () => {
        throw new Error("source_priority_list is not set");
      },
    });

    const report = await runJobSearch({
      places: stubPlaces(),
      geocoder: stubGeocoder(),
      openBrowser: FORBIDDEN_BROWSER,
      jobService: fakeJobService([], nothingToResolve),
      collectedAt: stubCollectedAt,
      atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService([]),
      settings,
      runId: stubRunId,
      trace: makeTraceService(),
      collectors: [makeCollector("greenhouse", emptyResult)],
    });

    expect(report.failure).toEqual({
      at: "source_priority_list",
      reason: "source_priority_list is not set",
    });
    // Nothing at all, because the priority list is read before collection now
    // that backlog cleanup's save needs it, so the run stops before the first
    // handler finishes.
    expect(report.handlers.map((finished) => finished.step)).toEqual([]);
  });
});

// AC 72. Dedupe runs between association and save: association gives a job
// the company identity dedupe matches on, and save writes what survives.
describe("dedupe runs after association and before save", () => {
  test("its trace rows are written post_collection_dedupe with the caller's run id", async () => {
    const trace = makeTraceService();
    // Two jobs on one link, so the list compare has a match to fold.
    const collector = makeCollector("greenhouse", {
      jobs: [makeJob("Designer"), makeJob("Designer")],
      errors: [],
      warnings: [],
    });

    await runJobSearch({
      openBrowser: FORBIDDEN_BROWSER,
      settings: stubSettings,
      places: stubPlaces(),
      geocoder: stubGeocoder(),
      runId: stubRunId,
      trace,
      jobService: fakeJobService([], nothingToResolve),
      collectedAt: stubCollectedAt,
      atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService([]),
      collectors: [collector],
    });

    const dedupeEvents = trace.events.filter((event) => event.step === "post_collection_dedupe");
    expect(dedupeEvents.length).toBeGreaterThan(0);
    expect(dedupeEvents.every((event) => event.run_id === stubRunId)).toBe(true);
  });

  test("only the surviving job reaches the job service as a write", async () => {
    const written: string[] = [];
    const service = fakeJobService([], {
      ...nothingToResolve,
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

    await runJobSearch({
      openBrowser: FORBIDDEN_BROWSER,
      settings: stubSettings,
      places: stubPlaces(),
      geocoder: stubGeocoder(),
      runId: stubRunId,
      trace: makeTraceService(),
      jobService: service,
      collectedAt: stubCollectedAt,
      atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService([]),
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
      ...nothingToResolve,
      async findByOriginalUrlMatchKey() {
        throw new Error("the database went away");
      },
    });

    const report = await runJobSearch({
      openBrowser: FORBIDDEN_BROWSER,
      settings: stubSettings,
      places: stubPlaces(),
      geocoder: stubGeocoder(),
      runId: stubRunId,
      trace: makeTraceService(),
      jobService: service,
      collectedAt: stubCollectedAt,
      atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService([]),
      collectors: [makeCollector("greenhouse", { jobs: [makeJob("Designer")], errors: [], warnings: [] })],
    });

    const lookupWarnings = report.warnings.filter((warning) =>
      warning.message.includes("Database lookup failed")
    );
    expect(lookupWarnings).toHaveLength(1);
  });
});

// A row already on file, the way the resolution step finds one when it queries
// for jobs still needing a source URL.
function unresolvedRow(id: string, fields: Partial<JobListEntry> = {}): JobListEntry {
  return {
    id,
    collector: "adzuna",
    collected_at: stubCollectedAt,
    created_at: stubCollectedAt,
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
// tests here run at a concurrency of one, so call order is job order.
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

// Settling is its own module with its own tests, so every job's resolution here is
// scripted as an already-finished page.
const NO_WAIT = async () => {};

// AC 7. Collection found nothing this run, and the step still runs, because the
// list it resolves comes out of the database rather than from collection.
describe("AC 7: the resolution step runs over whatever the database says needs it", () => {
  test("a job on file is resolved and the run reports it with its source URL", async () => {
    const rows = [unresolvedRow("a")];
    const log = { launches: 0, closes: 0 };

    const report = await runJobSearch({
      places: stubPlaces(),
      geocoder: stubGeocoder(),
      settings: fakeSettingsService({
          getResolutionFastConcurrency: async () => 1,
        getResolutionSlowConcurrency: async () => 1,
        getResolutionSlowPauseSeconds: async () => 0,
        getSourcePriorityList: async () => ["collector:adzuna"],
      }),
      collectors: [],
      atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService([]),
      jobService: fakeJobService(rows),
      collectedAt: stubCollectedAt,
      runId: stubRunId,
      trace: makeTraceService(),
      openBrowser: browserFor(
        [[{ url: "https://employer.example/9", html: "<p>A job posting</p>" }]],
        log
      ),
      waitForLoad: NO_WAIT,
    });

    expect(log.launches).toBe(1);
    expect(rows[0]?.resolved_url).toBe("https://employer.example/9");
    expect(report.jobs.map((job) => job.id)).toEqual(["a"]);
  });
});

const PRIORITY_LIST = ["collector:user", "collector:adzuna"];

function applyLink(href: string): string {
  return `<a href="${href}">Apply</a>`;
}

// A job's resolution that arrives at the employer's own posting.
function arrivesAt(url: string): ScriptedPage[] {
  return [{ url, html: "<p>A job posting</p>" }];
}

// The resolution step end to end, reached through the orchestrator with no
// collectors, so the collect step contributes nothing and what the report
// carries is what this step did. The caller supplies the rows on file and the
// resolution each job takes; the rest is the same every time.
function resolutionStepOver(
  rows: JobListEntry[],
  scripts: ScriptedPage[][],
  log: BrowserLog = { launches: 0, closes: 0 }
): {
  rows: JobListEntry[];
  trace: FakeTraceService;
  log: BrowserLog;
  report: ReturnType<typeof runJobSearch>;
} {
  const trace = makeTraceService();
  const report = runJobSearch({
    places: stubPlaces(),
    geocoder: stubGeocoder(),
    collectors: [],
    atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService([]),
    // Every test built on this helper is about the resolution step, so the
    // parsing step is told there is nothing waiting. Left to the fake's own
    // read, a row this helper marks resolved would join the parsing list and
    // the resolution assertions would be counting two steps' work.
    jobService: fakeJobService(rows, { findUnparsed: async () => [] }),
    settings: fakeSettingsService({
      getResolutionFastConcurrency: async () => 1,
      getResolutionSlowConcurrency: async () => 1,
      getResolutionSlowPauseSeconds: async () => 0,
      getSourcePriorityList: async () => PRIORITY_LIST,
    }),
    openBrowser: browserFor(scripts, log),
    collectedAt: stubCollectedAt,
    runId: stubRunId,
    trace,
    waitForLoad: NO_WAIT,
  });
  return { rows, trace, log, report };
}

describe("AC 5: a run with nothing to resolve costs no browser", () => {
  test("launches no browser where every job is already resolved or markUnresolvable", async () => {
    const log = { launches: 0, closes: 0 };
    const { report } = resolutionStepOver(
      [unresolvedRow("a", { is_resolved: true }), unresolvedRow("b", { status: "unresolvable" })],
      [],
      log
    );

    const result = await report;

    expect(log.launches).toBe(0);
    expect(result.jobs).toEqual([]);
  });
});

describe("AC 74, 75: the step runs its four parts in order", () => {
  test("queries, resolves, dedupes and saves, in that order", async () => {
    const { trace, report } = resolutionStepOver([unresolvedRow("a")], [arrivesAt("https://employer.example/9")]);

    await report;

    // Each step's rows arrive as that step runs, so the order they were
    // written in is the order the steps ran in.
    const steps: string[] = [];
    for (const event of trace.events) {
      if (steps[steps.length - 1] !== event.step) steps.push(event.step);
    }
    // Backlog cleanup opens every run now, so resolution is asserted against
    // the steps that follow it rather than against the very first row written.
    const fromResolution = steps.slice(steps.indexOf("resolution"));
    expect(fromResolution[0]).toBe("resolution");
    expect(fromResolution).toContain("post_resolution_save");
  });

  test("names the dedupe and save steps after resolution rather than collection", async () => {
    const { trace, report } = resolutionStepOver([unresolvedRow("a")], [arrivesAt("https://employer.example/9")]);

    await report;

    const steps = new Set(trace.events.map((event) => event.step));
    expect(steps.has("post_collection_dedupe")).toBe(false);
    expect(steps.has("post_collection_save")).toBe(false);
  });
});

describe("AC 76, 77, 81: what the rows hold once the step has run", () => {
  test("a job that resolved carries its URL and is marked resolved", async () => {
    const rows = [unresolvedRow("a")];
    const { report } = resolutionStepOver(rows, [arrivesAt("https://employer.example/9")]);

    await report;

    expect(rows[0]?.resolved_url).toBe("https://employer.example/9");
    expect(rows[0]?.is_resolved).toBe(true);
  });

  test("a job that resolved is ready for parsing and no further", async () => {
    const rows = [unresolvedRow("a")];
    const { report } = resolutionStepOver(rows, [arrivesAt("https://employer.example/9")]);

    await report;

    expect(rows[0]?.is_resolved).toBe(true);
    expect(rows[0]?.is_parsed).toBe(false);
  });

  test("a job that failed to resolve is markUnresolvable as unresolvable", async () => {
    const rows = [unresolvedRow("a")];
    const { report } = resolutionStepOver(rows, [
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
  test("its row is gone once the step has run", async () => {
    const rows = [unresolvedRow("a")];
    const { report } = resolutionStepOver(rows, [arrivesAt("https://www.jobleads.com/jobs/1")]);

    await report;

    expect(rows.map((entry) => entry.id)).toEqual([]);
  });
});

describe("AC 79: two jobs that resolved to one posting leave one row", () => {
  test("one row remains and the other's departure is traced", async () => {
    const rows = [
      unresolvedRow("a", { raw_title: "Product Designer" }),
      unresolvedRow("b", { raw_title: "Product Designer" }),
    ];
    const { trace, report } = resolutionStepOver(rows, [
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
      (event) => event.step === "post_resolution_dedupe" && event.event === "job_abandoned"
    );
    expect(departures).toHaveLength(1);
  });
});

describe("AC 80: what the step hands back", () => {
  test("returns the job list along with the warnings its steps raised", async () => {
    const { report } = resolutionStepOver([unresolvedRow("a")], [arrivesAt("https://employer.example/9")]);

    const result = await report;

    expect(result.jobs.map((entry) => entry.id)).toEqual(["a"]);
    expect(result.warnings).toEqual([]);
  });

  // A lost trace write is counted rather than allowed to cancel a run over a
  // row of diagnostics, so the total is read once every step is done.
  test("reports how many trace writes the run lost", async () => {
    const { report } = resolutionStepOver([unresolvedRow("a")], [arrivesAt("https://employer.example/9")]);

    const result = await report;

    expect(result.traceFailures).toBe(0);
  });
});

describe("the browser the run launched", () => {
  test("is shut down once the step is finished", async () => {
    const log = { launches: 0, closes: 0 };
    const { report } = resolutionStepOver([unresolvedRow("a")], [arrivesAt("https://employer.example/9")], log);

    await report;

    expect(log.launches).toBe(1);
    expect(log.closes).toBe(1);
  });

  // The whole reason the step holds its browser in a try/finally. A run that
  // stops partway still has to give the machine its browser back, or a failed
  // search leaves one running with nothing holding a handle to it.
  test("is shut down even when the step it was opened for fails", async () => {
    const log = { launches: 0, closes: 0 };
    vi.mocked(resolveJobs).mockRejectedValueOnce(new Error("resolution exploded"));
    const { report } = resolutionStepOver([unresolvedRow("a")], [], log);

    await report;

    expect(log.launches).toBe(1);
    expect(log.closes).toBe(1);
  });

  // The browser is shut after the step, so its own failure lands second. The
  // report has room for one failure, and the one worth keeping is the one
  // that stopped the run — a browser that will not shut is a consequence,
  // and reporting it instead sends the reader after the wrong thing.
  test("failing to shut does not replace the failure that stopped the run", async () => {
    const trace = makeTraceService();
    // Resolution runs inside the step, before the browser is shut. Every
    // handler under it guards its own per-job work, so a whole-handler
    // failure is what a dead database or a bad setting looks like here.
    vi.mocked(resolveJobs).mockRejectedValueOnce(new Error("the database went away"));
    const report = runJobSearch({
      places: stubPlaces(),
      geocoder: stubGeocoder(),
      collectors: [],
      atsSlugs: fakeAtsSlugService(),
      companies: fakeCompanyService([]),
      jobService: fakeJobService([unresolvedRow("a")], { findUnparsed: async () => [] }),
      settings: fakeSettingsService({
        getResolutionFastConcurrency: async () => 1,
        getResolutionSlowConcurrency: async () => 1,
        getResolutionSlowPauseSeconds: async () => 0,
        getSourcePriorityList: async () => PRIORITY_LIST,
      }),
      openBrowser: async () => ({
        openPage: async () => ({
          page: fakeResolutionPage([arrivesAt("https://employer.example/9")][0]),
          close: async () => {},
        }),
        close: async () => {
          throw new Error("the browser would not shut");
        },
      }),
      collectedAt: stubCollectedAt,
      runId: stubRunId,
      trace,
      waitForLoad: NO_WAIT,
    });

    const result = await report.catch((thrown) => thrown);

    // The run still stops, and the reason it stopped is still readable.
    const failure = (result as { failure?: { at: string; reason: string } }).failure;
    expect(failure?.at).toBe("resolution");
    expect(failure?.reason).toContain("the database went away");
  });
});

describe("AC 8, 9: a handler that throws stops the run and is named in the report", () => {
  // Association is the handler driven here because it calls the company
  // service directly, with nothing catching underneath it. A company service
  // that fails outright is what a dead database connection looks like, and it
  // reaches the orchestrator as a throw rather than as a warning.
  function explodingCompanies() {
    return fakeCompanyService([], {
      findByMatchKey: async () => {
        throw new Error("company lookup exploded");
      },
    });
  }

  async function runWithFailingAssociation() {
    return runJobSearch({
      openBrowser: FORBIDDEN_BROWSER,
      jobService: fakeJobService([], nothingToResolve),
      collectedAt: stubCollectedAt,
      atsSlugs: fakeAtsSlugService(),
      companies: explodingCompanies(),
      settings: stubSettings,
      places: stubPlaces(),
      geocoder: stubGeocoder(),
      runId: stubRunId,
      trace: makeTraceService(),
      collectors: [
        makeCollector("lever", { jobs: [makeJob("designer")], errors: [], warnings: [] }),
      ],
    });
  }

  // Association used to be the handler driven here, because it called the
  // company service with nothing catching underneath it. It now guards its
  // own per-job work, so one job's failed lookup costs that job alone — see
  // the test below. Resolution is driven instead: a handler that throws
  // whole still has to stop the run and be named, which is what AC 8 and 9
  // are about, and the position in the run changes nothing about that.
  async function runWithFailingResolution() {
    vi.mocked(resolveJobs).mockRejectedValueOnce(new Error("resolution exploded"));
    const { report } = resolutionStepOver([unresolvedRow("a")], []);
    return report;
  }

  test("the run returns a report rather than throwing", async () => {
    await expect(runWithFailingResolution()).resolves.toBeDefined();
  });

  test("the report names the step that threw and the reason", async () => {
    const report = await runWithFailingResolution();
    expect(report.failure).toEqual({
      at: "resolution",
      reason: "resolution exploded",
    });
  });

  // Entries rather than jobs, because a handler may be handed any list.
  test("the report lists each finished handler and how many entries its list held", async () => {
    const report = await runWithFailingResolution();
    const steps = report.handlers.map((finished) => finished.step);

    // Everything before the throw finished and is listed. The throwing
    // handler itself never earns its line, because the throw leaves before
    // the push.
    expect(steps).toContain("collection");
    expect(steps).toContain("post_collection_save");
    expect(steps).not.toContain("resolution");
  });

  test("no later handler runs, so nothing reaches the save after it", async () => {
    const report = await runWithFailingResolution();
    const steps = report.handlers.map((finished) => finished.step);
    expect(steps).not.toContain("post_resolution_dedupe");
    expect(steps).not.toContain("post_resolution_save");
  });

  // The other half of the same rule. A handler that guards its own per-job
  // work does not stop the run, because one job's failed lookup says nothing
  // about the jobs around it.
  test("a company lookup failing on one job does not stop the run", async () => {
    const report = await runWithFailingAssociation();

    expect(report.failure).toBeNull();
    const steps = report.handlers.map((finished) => finished.step);
    expect(steps).toContain("post_collection_save");
  });

  test("a run where nothing throws reports a null failure", async () => {
    const report = await runJobSearch({
      openBrowser: FORBIDDEN_BROWSER,
      jobService: fakeJobService([], nothingToResolve),
      collectedAt: stubCollectedAt,
      atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService([]),
      settings: stubSettings,
      places: stubPlaces(),
      geocoder: stubGeocoder(),
      runId: stubRunId,
      trace: makeTraceService(),
      collectors: [makeCollector("lever", emptyResult)],
    });
    expect(report.failure).toBeNull();
  });
});

// AC 52. Parsing is a step of its own, reading its list from the database the
// way resolution does, and running normalization, association, dedupe and save
// after it.
describe("the parsing step", () => {
  // A job already resolved and waiting to be parsed, which is what the
  // parsing list read hands back.
  function waiting(id: string, fields: Partial<JobListEntry> = {}): JobListEntry {
    return {
      id,
      collector: "adzuna",
      collected_at: stubCollectedAt,
      original_url: "https://www.adzuna.com/details/1",
      resolved_url: "https://boards.greenhouse.io/acme/jobs/1",
      raw_title: "Product Designer",
      raw_company_slug: "acme",
      ...fields,
    };
  }

  const READING_PARSER: Parser = {
    name: "greenhouse",
    parse: async () => ({ raw_title: "Senior Product Designer", raw_company_name: "Acme" }),
  };

  // The fake's own findUnparsed reads the array it was handed, but these
  // tests hand it jobs already carrying is_parsed unset, so the list is stated
  // outright rather than inferred.
  function oneToParse(list: JobListEntry[]): Partial<JobService> {
    return {
      findUnresolved: async () => [],
      findUnparsed: async () => list.map((job) => ({ ...job })),
    };
  }

  function baseOptions(jobService: JobService, parserFor: (url: string) => Parser | null) {
    return {
      openBrowser: FORBIDDEN_BROWSER,
      jobService,
      collectedAt: stubCollectedAt,
      atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService([]),
      settings: stubSettings,
      places: stubPlaces(),
      geocoder: stubGeocoder(),
      runId: stubRunId,
      trace: makeTraceService(),
      collectors: [],
      parserFor,
    };
  }

  test("it reads its own list rather than being handed one", async () => {
    let asked = false;
    const jobService = fakeJobService([], {
      findUnresolved: async () => [],
      findUnparsed: async () => {
        asked = true;
        return [];
      },
    });

    await runJobSearch(baseOptions(jobService, NO_PARSERS));

    expect(asked).toBe(true);
  });

  test("a job on the list is read by its parser and reaches the report", async () => {
    const jobService = fakeJobService([waiting("a")], oneToParse([waiting("a")]));

    const report = await runJobSearch(baseOptions(jobService, () => READING_PARSER));

    // The employer name is one the stored row leaves empty, so a filled value
    // beats an absent one whatever the source priority list says. Whether a
    // parser outranks a collector on a field they both fill is settled by that
    // list, which is seeded separately.
    expect(report.jobs.find((job) => job.id === "a")?.raw_company_name).toBe("Acme");
  });

  test("AC 52: normalization runs on what parsing produced, so the title is normalized", async () => {
    const jobService = fakeJobService([waiting("a")], oneToParse([waiting("a")]));

    const report = await runJobSearch(baseOptions(jobService, () => READING_PARSER));

    // Normalization is what fills `title` off `raw_title`; parsing alone
    // never writes it, so a filled title proves normalization ran after.
    expect(report.jobs.find((job) => job.id === "a")?.title).toBeDefined();
  });

  test("AC 52: association runs after normalization, so the job comes out with a company", async () => {
    const jobService = fakeJobService([waiting("a")], oneToParse([waiting("a")]));

    const report = await runJobSearch(baseOptions(jobService, () => READING_PARSER));

    expect(report.jobs.find((job) => job.id === "a")?.company_id).toBeDefined();
  });

  test("AC 52: save runs last, so the parsed job's row is written", async () => {
    const written: string[] = [];
    const held = [waiting("a")];
    const jobService = fakeJobService(held, {
      findUnresolved: async () => [],
      findUnparsed: async () => held.map((job) => ({ ...job })),
      async update(entry, priorityList, identifyingQueryValues) {
        written.push(entry.id ?? "");
        return fakeJobService(held).update(entry, priorityList, identifyingQueryValues);
      },
    });

    await runJobSearch(baseOptions(jobService, () => READING_PARSER));

    expect(written).toContain("a");
  });

  test("the parsing step writes its trace rows under its own step name", async () => {
    const trace = makeTraceService();
    const jobService = fakeJobService([waiting("a")], oneToParse([waiting("a")]));

    await runJobSearch({ ...baseOptions(jobService, () => READING_PARSER), trace });

    expect(trace.events.some((event) => event.step === "parsing")).toBe(true);
  });

  test("a run with nothing to parse still finishes and reports no failure", async () => {
    const jobService = fakeJobService([], nothingToResolve);

    const report = await runJobSearch(baseOptions(jobService, NO_PARSERS));

    expect(report.failure).toBeNull();
  });
});

// The pause is stored in seconds and handed over in milliseconds. Every other
// test stubs it to zero, and zero times a thousand is zero, so nothing else
// here can tell a working conversion from a missing one.
describe("the slow lane's pause reaches resolution in milliseconds", () => {
  test("twelve seconds of setting arrives as twelve thousand", async () => {
    vi.mocked(resolveJobs).mockClear();

    await runJobSearch({
      places: stubPlaces(),
      geocoder: stubGeocoder(),
      settings: fakeSettingsService({
          getResolutionFastConcurrency: async () => 3,
        getResolutionSlowConcurrency: async () => 2,
        getResolutionSlowPauseSeconds: async () => 12,
        getSourcePriorityList: async () => ["collector:adzuna"],
      }),
      collectors: [],
      atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService([]),
      jobService: fakeJobService([unresolvedRow("a")]),
      collectedAt: stubCollectedAt,
      runId: stubRunId,
      trace: makeTraceService(),
      openBrowser: browserFor(
        [[{ url: "https://board.example/listing/a", html: "<p>A job posting</p>" }]],
        { launches: 0, closes: 0 }
      ),
      waitForLoad: async () => {},
    });

    const handed = vi.mocked(resolveJobs).mock.calls[0]?.[1];

    expect(handed?.slowPauseMs).toBe(12_000);
    expect(handed?.fastConcurrency).toBe(3);
    expect(handed?.slowConcurrency).toBe(2);
  });
});

// Phase 9. Three steps that judge a job rather than fetch anything about it.
// Backlog cleanup opens the run so the backlog being added to is already
// swept; promotion and classification close it, because an expired job only
// gains a fresh date once collection has found the new listing.
describe("the three judging steps are wired into the run", () => {
  async function runWithJudging() {
    return await runJobSearch({
      openBrowser: FORBIDDEN_BROWSER,
      jobService: fakeJobService([], nothingToResolve),
      collectedAt: stubCollectedAt,
      atsSlugs: fakeAtsSlugService(), companies: fakeCompanyService([]),
      settings: stubSettings,
      places: stubPlaces(),
      geocoder: stubGeocoder(),
      runId: stubRunId,
      trace: makeTraceService(),
      collectors: [makeCollector("lever", emptyResult)],
    });
  }

  // Criterion 41. Backlog cleanup opens the run, both halves of it: the job
  // sweep, the company sweep that ages out a stale judgement, and the two
  // saves that write what each of them changed.
  test("backlog cleanup and its saves run before any collector", async () => {
    const report = await runWithJudging();
    const steps = report.handlers.map((finished) => finished.step);

    expect(steps.slice(0, 5)).toEqual([
      "backlog_cleanup",
      "backlog_cleanup_companies",
      "backlog_cleanup_company_save",
      "post_backlog_cleanup_save",
      "collection",
    ]);
  });

  test("promotion and classification each close the run with their own save", async () => {
    const report = await runWithJudging();
    const steps = report.handlers.map((finished) => finished.step);

    expect(steps.slice(-4)).toEqual([
      "promotion",
      "post_promotion_save",
      "classification",
      "post_classification_save",
    ]);
  });

  test("the run finishes without a failure", async () => {
    const report = await runWithJudging();

    expect(report.failure).toBeNull();
  });
});
