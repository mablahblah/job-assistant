import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, test } from "vitest";
import { runCollection, type CollectionReport } from "./search-orchestrator";
import type { Collector, CollectorContext, CollectorResult } from "../collectors/types";
import type { JobListEntry } from "../job-list-entry";
import type { SettingsService } from "../settings-service";
import type { UnusableCode } from "../collectors/job-usable";
import type { TraceEvent, TraceWriter } from "../trace-writer";
import { fakeSettingsService } from "../settings-service.fake";
import { fakeCompanyService } from "../company-service.fake";
import type { CompanyRecord } from "../company-service";

// The orchestrator only hands this to collectors, so no getter needs real
// behaviour. It is here to prove it arrives unchanged.
const stubSettings: SettingsService = fakeSettingsService();

// A fixed stand-in for the UUID scripts/collect.ts mints for a real run.
// These are unit tests, so the value is never parsed as a real UUID.
const stubRunId = "test-run-id";

// The shape crypto.randomUUID() produces: a version 4 UUID, lowercase hex,
// with the variant nibble fixed to one of 8/9/a/b.
const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

// A stand-in trace writer that keeps every event it was handed, so a test can
// read them back, and reports whichever failure count the test chooses. Each
// call builds its own events array, so no state carries between tests.
interface FakeTraceWriter extends TraceWriter {
  events: TraceEvent[];
}

function makeTraceWriter(failures = 0): FakeTraceWriter {
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

describe("AC 15: a collector that throws does not stop the run", () => {
  test("the thrown message is recorded as an error against that collector", async () => {
    const failing = makeThrowingCollector("greenhouse", "board unreachable");
    const report = await runCollection({ companies: fakeCompanyService([]), settings: stubSettings, runId: stubRunId, trace: makeTraceWriter(), collectors: [failing] });
    expect(report.errors).toEqual([{ collector: "greenhouse", message: "board unreachable" }]);
  });

  test("a collector listed after the failing one still runs", async () => {
    const failing = makeThrowingCollector("greenhouse", "board unreachable");
    const later = makeCollector("lever", emptyResult);
    await runCollection({ companies: fakeCompanyService([]), settings: stubSettings, runId: stubRunId, trace: makeTraceWriter(), collectors: [failing, later] });
    expect(later.wasCalled).toBe(true);
  });

  test("runCollection resolves rather than rejecting", async () => {
    const failing = makeThrowingCollector("greenhouse", "board unreachable");
    await expect(
      runCollection({ companies: fakeCompanyService([]), settings: stubSettings, runId: stubRunId, trace: makeTraceWriter(), collectors: [failing] })
    ).resolves.toBeDefined();
  });

  // A request can reject with a plain object rather than an Error. The error
  // recorded here is the one the user reads when a whole source falls over, so
  // it has to name the cause instead of flattening it to "[object Object]".
  test("a collector rejecting with a plain object still gets a readable error", async () => {
    const failing: Collector = {
      name: "adzuna",
      async collect() {
        throw { code: "ECONNRESET" };
      },
    };
    const report = await runCollection({ companies: fakeCompanyService([]), settings: stubSettings, runId: stubRunId, trace: makeTraceWriter(), collectors: [failing] });
    expect(report.errors).toEqual([{ collector: "adzuna", message: '{"code":"ECONNRESET"}' }]);
  });
});

describe("AC 16: a warning keeps the collector that produced it", () => {
  test("the warning's collector is the collector's name", async () => {
    const collector = makeCollector("greenhouse", {
      jobs: [],
      errors: [],
      warnings: ["stripe: board returned no postings"],
    });
    const report = await runCollection({ companies: fakeCompanyService([]), settings: stubSettings, runId: stubRunId, trace: makeTraceWriter(), collectors: [collector] });
    expect(report.warnings[0]?.collector).toBe("greenhouse");
  });

  test("the warning's message is the collector's string, unchanged", async () => {
    // The collector's own words are what name the board or search, so they
    // must survive intact — no rewriting, no truncation.
    const message = "stripe: board returned no postings";
    const collector = makeCollector("greenhouse", { jobs: [], errors: [], warnings: [message] });
    const report = await runCollection({ companies: fakeCompanyService([]), settings: stubSettings, runId: stubRunId, trace: makeTraceWriter(), collectors: [collector] });
    expect(report.warnings[0]?.message).toBe(message);
  });
});

describe("AC 18: a supplied log function reports each collector as it runs", () => {
  test("a line naming the collector is logged before collect runs", async () => {
    const lines: string[] = [];
    let lineCountWhenCollectRan = -1;
    const collector: Collector = {
      name: "lever",
      async collect() {
        // How many lines existed the instant collect started says whether
        // the start line was already written.
        lineCountWhenCollectRan = lines.length;
        return emptyResult;
      },
    };
    await runCollection({
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace: makeTraceWriter(),
      collectors: [collector],
      log: (message) => lines.push(message),
    });
    expect(lineCountWhenCollectRan).toBeGreaterThan(0);
  });

  test("the start line names the collector", async () => {
    const lines: string[] = [];
    const collector = makeCollector("lever", emptyResult);
    await runCollection({
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace: makeTraceWriter(),
      collectors: [collector],
      log: (message) => lines.push(message),
    });
    expect(lines[0]).toContain("lever");
  });

  test("the finish line names the collector", async () => {
    const lines: string[] = [];
    const collector = makeCollector("lever", emptyResult);
    await runCollection({
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace: makeTraceWriter(),
      collectors: [collector],
      log: (message) => lines.push(message),
    });
    expect(lines[lines.length - 1]).toContain("lever");
  });

  test("the finish line carries the job count", async () => {
    const lines: string[] = [];
    const collector = makeCollector("lever", {
      jobs: [makeJob("Designer"), makeJob("Researcher")],
      errors: [],
      warnings: [],
    });
    await runCollection({
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace: makeTraceWriter(),
      collectors: [collector],
      log: (message) => lines.push(message),
    });
    expect(lines[lines.length - 1]).toContain("2");
  });
});

// Four collectors failing four different ways, run once, so each test below
// checks its own corner of the same report. None of them needs the
// orchestrator to know which is which.
describe("AC 20: collectors that fail in different ways travel one channel", () => {
  let report: CollectionReport;

  beforeAll(async () => {
    const throwing = makeThrowingCollector("throwing", "network down");
    const erroring = makeCollector("erroring", { jobs: [], errors: ["bad response"], warnings: [] });
    const degraded = makeCollector("degraded", {
      jobs: [makeJob("Designer")],
      errors: [],
      warnings: ["one board skipped"],
    });
    const empty = makeCollector("empty", emptyResult);

    report = await runCollection({
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace: makeTraceWriter(),
      collectors: [throwing, erroring, degraded, empty],
    });
  });

  test("the throwing collector's error is in the report", () => {
    expect(report.errors).toContainEqual({ collector: "throwing", message: "network down" });
  });

  test("the erroring collector's error is in the report", () => {
    expect(report.errors).toContainEqual({ collector: "erroring", message: "bad response" });
  });

  test("the degraded collector's warning is in the report", () => {
    expect(report.warnings).toContainEqual({ collector: "degraded", message: "one board skipped" });
  });

  test("the degraded collector's job is still in the report", () => {
    // objectContaining ignores the id the orchestrator mints; every other
    // field, including the collector stamp, still has to match exactly.
    expect(report.jobs).toContainEqual(
      expect.objectContaining({ ...makeJob("Designer"), collector: "degraded" })
    );
  });

  test("the empty collector contributes no job", () => {
    expect(report.jobs.some((job) => job.collector === "empty")).toBe(false);
  });

  test("the empty collector contributes no error", () => {
    expect(report.errors.some((issue) => issue.collector === "empty")).toBe(false);
  });

  test("the empty collector contributes no warning", () => {
    expect(report.warnings.some((issue) => issue.collector === "empty")).toBe(false);
  });
});

describe("AC 21: errors and warnings from several collectors survive together", () => {
  let report: CollectionReport;

  beforeAll(async () => {
    const failingA = makeThrowingCollector("boardA", "boardA down");
    const warningC = makeCollector("boardC", { jobs: [], errors: [], warnings: ["boardC partial"] });
    const failingB = makeThrowingCollector("boardB", "boardB down");
    const warningD = makeCollector("boardD", { jobs: [], errors: [], warnings: ["boardD partial"] });

    report = await runCollection({
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace: makeTraceWriter(),
      collectors: [failingA, warningC, failingB, warningD],
    });
  });

  test("every error is present", () => {
    expect(report.errors).toEqual([
      { collector: "boardA", message: "boardA down" },
      { collector: "boardB", message: "boardB down" },
    ]);
  });

  test("every warning is present", () => {
    expect(report.warnings).toEqual([
      { collector: "boardC", message: "boardC partial" },
      { collector: "boardD", message: "boardD partial" },
    ]);
  });
});

describe("AC 22: when every collector fails, every failure is recorded", () => {
  test("one error is recorded per collector, not just the first", async () => {
    const collectors = [
      makeThrowingCollector("boardA", "boardA down"),
      makeThrowingCollector("boardB", "boardB down"),
      makeThrowingCollector("boardC", "boardC down"),
    ];
    const report = await runCollection({ companies: fakeCompanyService([]), settings: stubSettings, runId: stubRunId, trace: makeTraceWriter(), collectors });
    expect(report.errors).toEqual([
      { collector: "boardA", message: "boardA down" },
      { collector: "boardB", message: "boardB down" },
      { collector: "boardC", message: "boardC down" },
    ]);
  });
});

describe("AC 23: a limit of 0 collects nothing and asks for nothing", () => {
  test("no collector's collect is ever called", async () => {
    // A `limit || Infinity` implementation reads 0 as falsy and collects
    // without bound, so this checks collect was skipped rather than only
    // checking that the report came back small.
    const collector = makeCollector("dribbble", {
      jobs: [makeJob("Designer")],
      errors: [],
      warnings: [],
    });
    await runCollection({ companies: fakeCompanyService([]), settings: stubSettings, runId: stubRunId, trace: makeTraceWriter(), collectors: [collector], limit: 0 });
    expect(collector.wasCalled).toBe(false);
  });

  test("the report is empty", async () => {
    const collector = makeCollector("dribbble", {
      jobs: [makeJob("Designer")],
      errors: [],
      warnings: [],
    });
    const report = await runCollection({
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace: makeTraceWriter(),
      collectors: [collector],
      limit: 0,
    });
    expect(report).toEqual({ jobs: [], errors: [], warnings: [], traceFailures: 0 });
  });
});

describe("AC 24: a limit of 1 reaches every collector", () => {
  test("each collector sees context.limit as exactly 1", async () => {
    const first = makeCollector("dribbble", emptyResult);
    const second = makeCollector("lever", emptyResult);
    await runCollection({ companies: fakeCompanyService([]), settings: stubSettings, runId: stubRunId, trace: makeTraceWriter(), collectors: [first, second], limit: 1 });
    expect([first.contextReceived?.limit, second.contextReceived?.limit]).toEqual([1, 1]);
  });
});

describe("AC 25: every job carries the collector that produced it", () => {
  test("a job that left collector unset is stamped with the collector's name", async () => {
    const collector = makeCollector("lever", {
      jobs: [makeJob("Designer")],
      errors: [],
      warnings: [],
    });
    const report = await runCollection({ companies: fakeCompanyService([]), settings: stubSettings, runId: stubRunId, trace: makeTraceWriter(), collectors: [collector] });
    expect(report.jobs[0]?.collector).toBe("lever");
  });

  test("a job naming a different collector is overwritten with the true one", async () => {
    const collector = makeCollector("lever", {
      jobs: [{ ...makeJob("Designer"), collector: "lever-api" }],
      errors: [],
      warnings: [],
    });
    const report = await runCollection({ companies: fakeCompanyService([]), settings: stubSettings, runId: stubRunId, trace: makeTraceWriter(), collectors: [collector] });
    expect(report.jobs[0]?.collector).toBe("lever");
  });
});

describe("an omitted limit means collect everything", () => {
  test("context.limit is Infinity when no limit is supplied", async () => {
    const collector = makeCollector("dribbble", emptyResult);
    await runCollection({ companies: fakeCompanyService([]), settings: stubSettings, runId: stubRunId, trace: makeTraceWriter(), collectors: [collector] });
    expect(collector.contextReceived?.limit).toBe(Infinity);
  });
});

describe("the settings service reaches every collector", () => {
  test("context.settings is the instance handed to runCollection", async () => {
    const collector = makeCollector("dribbble", emptyResult);
    await runCollection({ companies: fakeCompanyService([]), settings: stubSettings, runId: stubRunId, trace: makeTraceWriter(), collectors: [collector] });
    expect(collector.contextReceived?.settings).toBe(stubSettings);
  });
});

describe("collectors run in the order they are given", () => {
  test("collect is invoked in that order", async () => {
    const order: string[] = [];
    const first: Collector = {
      name: "first",
      async collect() {
        order.push("first");
        return emptyResult;
      },
    };
    const second: Collector = {
      name: "second",
      async collect() {
        order.push("second");
        return emptyResult;
      },
    };
    await runCollection({ companies: fakeCompanyService([]), settings: stubSettings, runId: stubRunId, trace: makeTraceWriter(), collectors: [first, second] });
    expect(order).toEqual(["first", "second"]);
  });

  test("their job lists are concatenated in that order", async () => {
    const first = makeCollector("first", { jobs: [makeJob("Designer")], errors: [], warnings: [] });
    const second = makeCollector("second", {
      jobs: [makeJob("Researcher")],
      errors: [],
      warnings: [],
    });
    const report = await runCollection({ companies: fakeCompanyService([]), settings: stubSettings, runId: stubRunId, trace: makeTraceWriter(), collectors: [first, second] });
    expect(report.jobs.map((job) => job.raw_title)).toEqual(["Designer", "Researcher"]);
  });
});

describe("AC 110: the check runs once in the orchestrator, over every collector", () => {
  test("both collectors keep their good job and drop their bad one", async () => {
    const first = makeCollector("lever", {
      jobs: [makeJob("Designer"), { ...makeJob("Researcher"), raw_title: undefined }],
      errors: [],
      warnings: [],
    });
    const second = makeCollector("greenhouse", {
      jobs: [makeJob("Writer"), { ...makeJob("Editor"), raw_title: undefined }],
      errors: [],
      warnings: [],
    });
    const report = await runCollection({ companies: fakeCompanyService([]), settings: stubSettings, runId: stubRunId, trace: makeTraceWriter(), collectors: [first, second] });
    expect(report.jobs.map((job) => job.raw_title)).toEqual(["Designer", "Writer"]);
  });

  test("each drop is attributed to the collector that produced it", async () => {
    const first = makeCollector("lever", {
      jobs: [{ ...makeJob("Researcher"), raw_title: undefined }],
      errors: [],
      warnings: [],
    });
    const second = makeCollector("greenhouse", {
      jobs: [{ ...makeJob("Editor"), raw_title: undefined }],
      errors: [],
      warnings: [],
    });
    const report = await runCollection({ companies: fakeCompanyService([]), settings: stubSettings, runId: stubRunId, trace: makeTraceWriter(), collectors: [first, second] });
    expect(report.warnings.map((issue) => issue.collector)).toEqual(["lever", "greenhouse"]);
  });
});

describe("AC 111: a dropped job is a warning, not an error", () => {
  test("errors stays empty while warnings gains an entry", async () => {
    const collector = makeCollector("lever", {
      jobs: [{ ...makeJob("Designer"), raw_title: undefined }],
      errors: [],
      warnings: [],
    });
    const report = await runCollection({ companies: fakeCompanyService([]), settings: stubSettings, runId: stubRunId, trace: makeTraceWriter(), collectors: [collector] });
    expect(report.errors).toEqual([]);
    expect(report.warnings).toHaveLength(1);
  });
});

describe("a dropped job's warning names the job", () => {
  test("a job with a title is named by its title", async () => {
    const collector = makeCollector("lever", {
      // A missing company drops the job and leaves the title intact to name it by.
      jobs: [{ ...makeJob("Designer"), raw_company_name: undefined }],
      errors: [],
      warnings: [],
    });
    const report = await runCollection({ companies: fakeCompanyService([]), settings: stubSettings, runId: stubRunId, trace: makeTraceWriter(), collectors: [collector] });
    expect(report.warnings[0]?.message).toContain("Designer");
  });

  test("a job with no title but a URL is named by its URL", async () => {
    const collector = makeCollector("lever", {
      jobs: [{ ...makeJob("Designer"), raw_title: undefined }],
      errors: [],
      warnings: [],
    });
    const report = await runCollection({ companies: fakeCompanyService([]), settings: stubSettings, runId: stubRunId, trace: makeTraceWriter(), collectors: [collector] });
    expect(report.warnings[0]?.message).toContain("https://example.com/Designer");
  });

  test("a job with neither title nor URL still reads cleanly", async () => {
    // Built directly rather than from makeJob, which always supplies both.
    const noIdentity: JobListEntry = { raw_company_name: "Example" };
    const collector = makeCollector("lever", { jobs: [noIdentity], errors: [], warnings: [] });
    const report = await runCollection({ companies: fakeCompanyService([]), settings: stubSettings, runId: stubRunId, trace: makeTraceWriter(), collectors: [collector] });
    expect(report.warnings[0]?.message).not.toContain("undefined");
  });

  test("the warning says why the job was dropped", async () => {
    const collector = makeCollector("lever", {
      jobs: [{ ...makeJob("Designer"), raw_title: undefined }],
      errors: [],
      warnings: [],
    });
    const report = await runCollection({ companies: fakeCompanyService([]), settings: stubSettings, runId: stubRunId, trace: makeTraceWriter(), collectors: [collector] });
    expect(report.warnings[0]?.message).toContain("raw_title");
  });
});

describe("a dropped job does not reach the job list", () => {
  test("report.jobs holds only the good job", async () => {
    const collector = makeCollector("lever", {
      jobs: [makeJob("Designer"), { ...makeJob("Researcher"), raw_title: undefined }],
      errors: [],
      warnings: [],
    });
    const report = await runCollection({ companies: fakeCompanyService([]), settings: stubSettings, runId: stubRunId, trace: makeTraceWriter(), collectors: [collector] });
    expect(report.jobs.map((job) => job.raw_title)).toEqual(["Designer"]);
  });

  test("a collector of only good jobs keeps all of them and warns about none", async () => {
    const collector = makeCollector("lever", {
      jobs: [makeJob("Designer"), makeJob("Researcher")],
      errors: [],
      warnings: [],
    });
    const report = await runCollection({ companies: fakeCompanyService([]), settings: stubSettings, runId: stubRunId, trace: makeTraceWriter(), collectors: [collector] });
    expect(report.jobs).toHaveLength(2);
    expect(report.warnings).toEqual([]);
  });
});

describe("the finish line reports what was kept and what was dropped", () => {
  test("kept and dropped counts both appear when one job of two is dropped", async () => {
    const lines: string[] = [];
    const collector = makeCollector("lever", {
      jobs: [makeJob("Designer"), { ...makeJob("Researcher"), raw_title: undefined }],
      errors: [],
      warnings: [],
    });
    await runCollection({
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace: makeTraceWriter(),
      collectors: [collector],
      log: (message) => lines.push(message),
    });
    const finishLine = lines[lines.length - 1] ?? "";
    expect(finishLine).toContain("kept=1");
    expect(finishLine).toContain("dropped=1");
  });

  test("nothing dropped means the finish line says nothing about dropping", async () => {
    const lines: string[] = [];
    const collector = makeCollector("lever", {
      jobs: [makeJob("Designer")],
      errors: [],
      warnings: [],
    });
    await runCollection({
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace: makeTraceWriter(),
      collectors: [collector],
      log: (message) => lines.push(message),
    });
    expect(lines[lines.length - 1] ?? "").not.toContain("dropped");
  });
});

describe("a collector's own warnings survive alongside a dropped-job warning", () => {
  test("one does not displace the other", async () => {
    const collector = makeCollector("lever", {
      jobs: [{ ...makeJob("Researcher"), raw_title: undefined }],
      errors: [],
      warnings: ["board returned a partial page"],
    });
    const report = await runCollection({ companies: fakeCompanyService([]), settings: stubSettings, runId: stubRunId, trace: makeTraceWriter(), collectors: [collector] });
    expect(report.warnings).toHaveLength(2);
    expect(report.warnings).toContainEqual({
      collector: "lever",
      message: "board returned a partial page",
    });
  });
});

describe("every job is assigned an id shaped like crypto.randomUUID()", () => {
  test("a job that passes the usability check has a v4 UUID for an id", async () => {
    const collector = makeCollector("lever", { jobs: [makeJob("Designer")], errors: [], warnings: [] });
    const report = await runCollection({
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace: makeTraceWriter(),
      collectors: [collector],
    });
    expect(report.jobs[0]?.id).toMatch(looksLikeUuid);
  });
});

describe("a job that passes the usability check carries the id it was assigned", () => {
  test("a job with no id going in leaves the job list with one", async () => {
    const job = makeJob("Designer");
    expect(job.id).toBeUndefined();
    const collector = makeCollector("lever", { jobs: [job], errors: [], warnings: [] });
    const report = await runCollection({
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace: makeTraceWriter(),
      collectors: [collector],
    });
    expect(report.jobs[0]?.id).toBeDefined();
  });
});

describe("no two jobs in a run share an id", () => {
  test("ids stay unique across several collectors and several jobs each", async () => {
    const first = makeCollector("lever", {
      jobs: [makeJob("Designer"), makeJob("Researcher")],
      errors: [],
      warnings: [],
    });
    const second = makeCollector("greenhouse", {
      jobs: [makeJob("Writer"), makeJob("Editor")],
      errors: [],
      warnings: [],
    });
    const report = await runCollection({
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace: makeTraceWriter(),
      collectors: [first, second],
    });
    const ids = report.jobs.map((job) => job.id);
    expect(new Set(ids).size).toBe(report.jobs.length);
  });
});

describe("a collector cannot assign a job's id itself", () => {
  test("an id a collector set on a job is overwritten with one the orchestrator mints", async () => {
    const collector = makeCollector("lever", {
      jobs: [{ ...makeJob("Designer"), id: "set-by-the-collector" }],
      errors: [],
      warnings: [],
    });
    const report = await runCollection({
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace: makeTraceWriter(),
      collectors: [collector],
    });
    expect(report.jobs[0]?.id).not.toBe("set-by-the-collector");
    expect(report.jobs[0]?.id).toMatch(looksLikeUuid);
  });
});

describe("the orchestrator takes its run id from its caller and never mints one itself", () => {
  test("the orchestrator never assigns a generated value to runId", () => {
    // The orchestrator mints job ids with randomUUID, so a blanket ban on that
    // call would be wrong. What still has to hold is that runId itself is never
    // bound to a freshly generated value — only ever to the caller's own.
    const orchestratorPath = join(dirname(fileURLToPath(import.meta.url)), "search-orchestrator.ts");
    const source = readFileSync(orchestratorPath, "utf-8");
    expect(source).not.toMatch(/runId\s*[:=]\s*(?:\w+\.)?randomUUID\s*\(/);
  });
});

describe("the trace writer's failure count reaches the report as traceFailures", () => {
  test("a nonzero failure count from the trace writer appears on report.traceFailures", async () => {
    const trace = makeTraceWriter(3);
    const collector = makeCollector("lever", emptyResult);
    const report = await runCollection({
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace,
      collectors: [collector],
    });
    expect(report.traceFailures).toBe(3);
  });

  test("report.traceFailures is 0 when the trace writer records no failures", async () => {
    const trace = makeTraceWriter(0);
    const collector = makeCollector("lever", emptyResult);
    const report = await runCollection({
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace,
      collectors: [collector],
    });
    expect(report.traceFailures).toBe(0);
  });
});

describe("a collected event is written for every job as it enters the loop", () => {
  test("the event carries step collection, the collector's name, and the job's id", async () => {
    const trace = makeTraceWriter();
    const collector = makeCollector("lever", {
      jobs: [makeJob("Designer")],
      errors: [],
      warnings: [],
    });
    const report = await runCollection({
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace,
      collectors: [collector],
    });
    const collected = trace.events.find((event) => event.event === "collected");
    expect(collected).toMatchObject({
      step: "collection",
      collector: "lever",
      job_id: report.jobs[0]?.id,
    });
  });

  test("the event carries the run id its caller supplied", async () => {
    const trace = makeTraceWriter();
    const collector = makeCollector("lever", {
      jobs: [makeJob("Designer")],
      errors: [],
      warnings: [],
    });
    await runCollection({
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace,
      collectors: [collector],
    });
    expect(trace.events.every((event) => event.run_id === stubRunId)).toBe(true);
  });
});

describe("a job dropped by the usability check gets both a collected and an abandoned event", () => {
  test("both events exist, in that order, for the same job", async () => {
    const trace = makeTraceWriter();
    const collector = makeCollector("lever", {
      jobs: [{ ...makeJob("Researcher"), raw_title: undefined }],
      errors: [],
      warnings: [],
    });
    await runCollection({
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace,
      collectors: [collector],
    });
    expect(trace.events.map((event) => event.event)).toEqual(["collected", "abandoned"]);
    expect(trace.events[0]?.job_id).toBe(trace.events[1]?.job_id);
  });
});

describe("a job that passes the usability check gets a collected event and no abandoned event", () => {
  test("abandoned never appears for that job", async () => {
    const trace = makeTraceWriter();
    const collector = makeCollector("lever", {
      jobs: [makeJob("Designer")],
      errors: [],
      warnings: [],
    });
    await runCollection({
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace,
      collectors: [collector],
    });
    // Normalization writes its own events for this job, so the check is that
    // no abandoned event exists rather than that collected is the only event.
    const collectionEvents = trace.events.filter((event) => event.step === "collection");
    expect(collectionEvents.map((event) => event.event)).toEqual(["collected"]);
  });
});

describe("an abandoned event's reason is always one of the usability check's codes", () => {
  test("every reason recorded belongs to the set of six codes", async () => {
    // Typed against UnusableCode, so this list stops compiling if job-usable.ts
    // ever adds or renames a code.
    const validCodes: UnusableCode[] = [
      "no_original_url",
      "original_url_not_a_url",
      "no_raw_title",
      "no_company_identity",
      "posting_date_unparseable",
      "posting_updated_date_unparseable",
    ];
    const trace = makeTraceWriter();
    const collector = makeCollector("lever", {
      jobs: [
        { ...makeJob("A"), original_url: undefined },
        { ...makeJob("B"), original_url: "not-a-url" },
        { ...makeJob("C"), raw_title: undefined },
        { ...makeJob("D"), raw_company_name: undefined },
      ],
      errors: [],
      warnings: [],
    });
    await runCollection({
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace,
      collectors: [collector],
    });
    const reasons = trace.events
      .filter((event) => event.event === "abandoned")
      .map((event) => event.reason);
    expect(reasons).toHaveLength(4);
    for (const reason of reasons) {
      expect(validCodes).toContain(reason);
    }
  });
});

describe("a malformed URL is abandoned naming itself in the detail", () => {
  test("the reason is original_url_not_a_url and detail carries the offending value", async () => {
    const trace = makeTraceWriter();
    const collector = makeCollector("lever", {
      jobs: [{ ...makeJob("Designer"), original_url: "not-a-url" }],
      errors: [],
      warnings: [],
    });
    await runCollection({
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace,
      collectors: [collector],
    });
    const abandoned = trace.events.find((event) => event.event === "abandoned");
    expect(abandoned?.reason).toBe("original_url_not_a_url");
    expect(abandoned?.detail).toBe("not-a-url");
  });
});

describe("a collector that throws leaves no trace event behind", () => {
  test("no trace event exists for its jobs", async () => {
    const trace = makeTraceWriter();
    const failing = makeThrowingCollector("greenhouse", "board unreachable");
    await runCollection({
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace,
      collectors: [failing],
    });
    expect(trace.events).toEqual([]);
  });
});

describe("a collector's own error or warning writes no trace event", () => {
  test("an error string produces no trace event", async () => {
    const trace = makeTraceWriter();
    const collector = makeCollector("greenhouse", {
      jobs: [],
      errors: ["bad response"],
      warnings: [],
    });
    await runCollection({
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace,
      collectors: [collector],
    });
    expect(trace.events).toEqual([]);
  });

  test("a warning string produces no trace event", async () => {
    const trace = makeTraceWriter();
    const collector = makeCollector("greenhouse", {
      jobs: [],
      errors: [],
      warnings: ["board returned no postings"],
    });
    await runCollection({
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace,
      collectors: [collector],
    });
    expect(trace.events).toEqual([]);
  });
});

describe("a collector that produces no jobs writes no trace events", () => {
  test("trace stays empty", async () => {
    const trace = makeTraceWriter();
    const collector = makeCollector("lever", emptyResult);
    await runCollection({
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace,
      collectors: [collector],
    });
    expect(trace.events).toEqual([]);
  });
});

describe("a limit of 0 writes no trace events", () => {
  test("trace stays empty even though the collector has a job to give", async () => {
    const trace = makeTraceWriter();
    const collector = makeCollector("lever", {
      jobs: [makeJob("Designer")],
      errors: [],
      warnings: [],
    });
    await runCollection({
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace,
      collectors: [collector],
      limit: 0,
    });
    expect(trace.events).toEqual([]);
  });
});

describe("every trace event collection writes carries the collection step", () => {
  test("step reads collection for both collected and abandoned events", async () => {
    const trace = makeTraceWriter();
    const collector = makeCollector("lever", {
      jobs: [makeJob("Designer"), { ...makeJob("Researcher"), raw_title: undefined }],
      errors: [],
      warnings: [],
    });
    await runCollection({
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace,
      collectors: [collector],
    });
    // Normalization writes its own events at a different step, so the sweep
    // is scoped to the two events collection itself is responsible for.
    const collectionEvents = trace.events.filter(
      (event) => event.event === "collected" || event.event === "abandoned"
    );
    expect(collectionEvents.length).toBeGreaterThan(0);
    for (const event of collectionEvents) {
      expect(event.step).toBe("collection");
    }
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
      companies: fakeCompanyService([]),
      settings: settingsWithVocabularies(),
      runId: stubRunId,
      trace: makeTraceWriter(),
      collectors: [collector],
    });
    expect(report.jobs[0]?.title).toBe("Sr. Designer");
  });
});

describe("normalization writes its own trace events after collection", () => {
  test("one ordinary job writes two of them", async () => {
    // stubSettings holds no vocabulary, so this job's title finds no job noun
    // and its company name tidies. Two raw fields acted on, two events.
    const trace = makeTraceWriter();
    const collector = makeCollector("lever", {
      jobs: [makeJob("Designer")],
      errors: [],
      warnings: [],
    });
    await runCollection({ companies: fakeCompanyService([]), settings: stubSettings, runId: stubRunId, trace, collectors: [collector] });
    const normalization = trace.events.filter(
      (event) => event.step === "post_collection_normalization"
    );
    expect(normalization).toHaveLength(2);
  });

  test("each one shares the job_id of that job's collected event", async () => {
    // What lets one job's whole path be read back as a single journey.
    const trace = makeTraceWriter();
    const collector = makeCollector("lever", {
      jobs: [makeJob("Designer")],
      errors: [],
      warnings: [],
    });
    await runCollection({ companies: fakeCompanyService([]), settings: stubSettings, runId: stubRunId, trace, collectors: [collector] });
    const collected = trace.events.find((event) => event.event === "collected");
    const normalization = trace.events.filter(
      (event) => event.step === "post_collection_normalization"
    );
    for (const event of normalization) {
      expect(event.job_id).toBe(collected?.job_id);
    }
  });

  test("each one names the collector that found the job", async () => {
    const trace = makeTraceWriter();
    const collector = makeCollector("greenhouse", {
      jobs: [makeJob("Designer")],
      errors: [],
      warnings: [],
    });
    await runCollection({ companies: fakeCompanyService([]), settings: stubSettings, runId: stubRunId, trace, collectors: [collector] });
    const normalization = trace.events.filter(
      (event) => event.step === "post_collection_normalization"
    );
    for (const event of normalization) {
      expect(event.collector).toBe("greenhouse");
    }
  });

  test("a title event carries its reason and the change it made", async () => {
    const trace = makeTraceWriter();
    const collector = makeCollector("lever", {
      jobs: [makeJob("Senior Designer")],
      errors: [],
      warnings: [],
    });
    await runCollection({
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
    const trace = makeTraceWriter();
    const first = makeCollector("lever", { jobs: [makeJob("Designer")], errors: [], warnings: [] });
    const second = makeCollector("greenhouse", { jobs: [makeJob("Researcher")], errors: [], warnings: [] });
    await runCollection({ companies: fakeCompanyService([]), settings: stubSettings, runId: stubRunId, trace, collectors: [first, second] });

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
      companies: fakeCompanyService([]),
      settings: settingsWithVocabularies(),
      runId: stubRunId,
      trace: makeTraceWriter(),
      collectors: [first, second],
    });

    expect(report.jobs.map((job) => job.title)).toEqual(["Sr. Designer", "Sr. UX Designer"]);
  });
});

describe("a job that never reaches the normalizer gets no normalization event", () => {
  test("a job dropped by the usability check writes none", async () => {
    const trace = makeTraceWriter();
    const collector = makeCollector("lever", {
      jobs: [{ ...makeJob("Researcher"), raw_title: undefined }],
      errors: [],
      warnings: [],
    });
    await runCollection({ companies: fakeCompanyService([]), settings: stubSettings, runId: stubRunId, trace, collectors: [collector] });
    expect(trace.events.some((event) => event.step === "post_collection_normalization")).toBe(false);
  });

  test("a collector that throws writes none", async () => {
    const trace = makeTraceWriter();
    const failing = makeThrowingCollector("greenhouse", "board unreachable");
    await runCollection({ companies: fakeCompanyService([]), settings: stubSettings, runId: stubRunId, trace, collectors: [failing] });
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
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace: makeTraceWriter(),
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
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace: makeTraceWriter(),
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
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace: makeTraceWriter(),
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
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: stubRunId,
      trace: makeTraceWriter(),
      collectors: [makeCollector("lever", { jobs: [job], errors: [], warnings: [] })],
    });
    const withVocabulary = await runCollection({
      companies: fakeCompanyService([]),
      settings: withNoun,
      runId: stubRunId,
      trace: makeTraceWriter(),
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
      trace: makeTraceWriter(),
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
      trace: makeTraceWriter(),
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
      trace: makeTraceWriter(),
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
      trace: makeTraceWriter(),
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
      trace: makeTraceWriter(),
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
      trace: makeTraceWriter(),
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
    const trace = makeTraceWriter();
    const job = { ...makeJob("Product Designer"), raw_company_name: "Brightwave Labs" };

    await runCollection({
      settings: stubSettings,
      runId: stubRunId,
      trace,
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
