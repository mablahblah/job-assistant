import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, test } from "vitest";
import { runCollection, type CollectionReport } from "./search-orchestrator";
import type { Collector, CollectorContext, CollectorResult } from "./collectors/types";
import type { JobListEntry } from "./job-list-entry";
import type { SettingsService } from "./settings-service";

// The orchestrator only hands this to collectors, so no getter needs real
// behaviour. It is here to prove it arrives unchanged.
const stubSettings: SettingsService = {
  getSearchTerms: async () => [],
  getLocation: async () => "",
  getRadius: async () => 0,
  getExpiryThreshold: async () => 0,
  getAtsCompanies: async () => [],
};

// A fixed stand-in for the UUID scripts/collect.ts mints for a real run.
// These are unit tests, so the value is never parsed as a real UUID.
const stubRunId = "test-run-id";

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

const emptyResult: CollectorResult = { jobs: [], errors: [], warnings: [] };

describe("AC 15: a collector that throws does not stop the run", () => {
  test("the thrown message is recorded as an error against that collector", async () => {
    const failing = makeThrowingCollector("greenhouse", "board unreachable");
    const report = await runCollection({ settings: stubSettings, runId: stubRunId, collectors: [failing] });
    expect(report.errors).toEqual([{ collector: "greenhouse", message: "board unreachable" }]);
  });

  test("a collector listed after the failing one still runs", async () => {
    const failing = makeThrowingCollector("greenhouse", "board unreachable");
    const later = makeCollector("lever", emptyResult);
    await runCollection({ settings: stubSettings, runId: stubRunId, collectors: [failing, later] });
    expect(later.wasCalled).toBe(true);
  });

  test("runCollection resolves rather than rejecting", async () => {
    const failing = makeThrowingCollector("greenhouse", "board unreachable");
    await expect(
      runCollection({ settings: stubSettings, runId: stubRunId, collectors: [failing] })
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
    const report = await runCollection({ settings: stubSettings, runId: stubRunId, collectors: [failing] });
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
    const report = await runCollection({ settings: stubSettings, runId: stubRunId, collectors: [collector] });
    expect(report.warnings[0]?.collector).toBe("greenhouse");
  });

  test("the warning's message is the collector's string, unchanged", async () => {
    // The collector's own words are what name the board or search, so they
    // must survive intact — no rewriting, no truncation.
    const message = "stripe: board returned no postings";
    const collector = makeCollector("greenhouse", { jobs: [], errors: [], warnings: [message] });
    const report = await runCollection({ settings: stubSettings, runId: stubRunId, collectors: [collector] });
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
      settings: stubSettings,
      runId: stubRunId,
      collectors: [collector],
      log: (message) => lines.push(message),
    });
    expect(lineCountWhenCollectRan).toBeGreaterThan(0);
  });

  test("the start line names the collector", async () => {
    const lines: string[] = [];
    const collector = makeCollector("lever", emptyResult);
    await runCollection({
      settings: stubSettings,
      runId: stubRunId,
      collectors: [collector],
      log: (message) => lines.push(message),
    });
    expect(lines[0]).toContain("lever");
  });

  test("the finish line names the collector", async () => {
    const lines: string[] = [];
    const collector = makeCollector("lever", emptyResult);
    await runCollection({
      settings: stubSettings,
      runId: stubRunId,
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
      settings: stubSettings,
      runId: stubRunId,
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
      settings: stubSettings,
      runId: stubRunId,
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
    expect(report.jobs).toContainEqual({ ...makeJob("Designer"), collector: "degraded" });
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
      settings: stubSettings,
      runId: stubRunId,
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
    const report = await runCollection({ settings: stubSettings, runId: stubRunId, collectors });
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
    await runCollection({ settings: stubSettings, runId: stubRunId, collectors: [collector], limit: 0 });
    expect(collector.wasCalled).toBe(false);
  });

  test("the report is empty", async () => {
    const collector = makeCollector("dribbble", {
      jobs: [makeJob("Designer")],
      errors: [],
      warnings: [],
    });
    const report = await runCollection({
      settings: stubSettings,
      runId: stubRunId,
      collectors: [collector],
      limit: 0,
    });
    expect(report).toEqual({ jobs: [], errors: [], warnings: [] });
  });
});

describe("AC 24: a limit of 1 reaches every collector", () => {
  test("each collector sees context.limit as exactly 1", async () => {
    const first = makeCollector("dribbble", emptyResult);
    const second = makeCollector("lever", emptyResult);
    await runCollection({ settings: stubSettings, runId: stubRunId, collectors: [first, second], limit: 1 });
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
    const report = await runCollection({ settings: stubSettings, runId: stubRunId, collectors: [collector] });
    expect(report.jobs[0]?.collector).toBe("lever");
  });

  test("a job naming a different collector is overwritten with the true one", async () => {
    const collector = makeCollector("lever", {
      jobs: [{ ...makeJob("Designer"), collector: "lever-api" }],
      errors: [],
      warnings: [],
    });
    const report = await runCollection({ settings: stubSettings, runId: stubRunId, collectors: [collector] });
    expect(report.jobs[0]?.collector).toBe("lever");
  });
});

describe("an omitted limit means collect everything", () => {
  test("context.limit is Infinity when no limit is supplied", async () => {
    const collector = makeCollector("dribbble", emptyResult);
    await runCollection({ settings: stubSettings, runId: stubRunId, collectors: [collector] });
    expect(collector.contextReceived?.limit).toBe(Infinity);
  });
});

describe("the settings service reaches every collector", () => {
  test("context.settings is the instance handed to runCollection", async () => {
    const collector = makeCollector("dribbble", emptyResult);
    await runCollection({ settings: stubSettings, runId: stubRunId, collectors: [collector] });
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
    await runCollection({ settings: stubSettings, runId: stubRunId, collectors: [first, second] });
    expect(order).toEqual(["first", "second"]);
  });

  test("their job lists are concatenated in that order", async () => {
    const first = makeCollector("first", { jobs: [makeJob("Designer")], errors: [], warnings: [] });
    const second = makeCollector("second", {
      jobs: [makeJob("Researcher")],
      errors: [],
      warnings: [],
    });
    const report = await runCollection({ settings: stubSettings, runId: stubRunId, collectors: [first, second] });
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
    const report = await runCollection({ settings: stubSettings, runId: stubRunId, collectors: [first, second] });
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
    const report = await runCollection({ settings: stubSettings, runId: stubRunId, collectors: [first, second] });
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
    const report = await runCollection({ settings: stubSettings, runId: stubRunId, collectors: [collector] });
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
    const report = await runCollection({ settings: stubSettings, runId: stubRunId, collectors: [collector] });
    expect(report.warnings[0]?.message).toContain("Designer");
  });

  test("a job with no title but a URL is named by its URL", async () => {
    const collector = makeCollector("lever", {
      jobs: [{ ...makeJob("Designer"), raw_title: undefined }],
      errors: [],
      warnings: [],
    });
    const report = await runCollection({ settings: stubSettings, runId: stubRunId, collectors: [collector] });
    expect(report.warnings[0]?.message).toContain("https://example.com/Designer");
  });

  test("a job with neither title nor URL still reads cleanly", async () => {
    // Built directly rather than from makeJob, which always supplies both.
    const noIdentity: JobListEntry = { raw_company_name: "Example" };
    const collector = makeCollector("lever", { jobs: [noIdentity], errors: [], warnings: [] });
    const report = await runCollection({ settings: stubSettings, runId: stubRunId, collectors: [collector] });
    expect(report.warnings[0]?.message).not.toContain("undefined");
  });

  test("the warning says why the job was dropped", async () => {
    const collector = makeCollector("lever", {
      jobs: [{ ...makeJob("Designer"), raw_title: undefined }],
      errors: [],
      warnings: [],
    });
    const report = await runCollection({ settings: stubSettings, runId: stubRunId, collectors: [collector] });
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
    const report = await runCollection({ settings: stubSettings, runId: stubRunId, collectors: [collector] });
    expect(report.jobs.map((job) => job.raw_title)).toEqual(["Designer"]);
  });

  test("a collector of only good jobs keeps all of them and warns about none", async () => {
    const collector = makeCollector("lever", {
      jobs: [makeJob("Designer"), makeJob("Researcher")],
      errors: [],
      warnings: [],
    });
    const report = await runCollection({ settings: stubSettings, runId: stubRunId, collectors: [collector] });
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
      settings: stubSettings,
      runId: stubRunId,
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
      settings: stubSettings,
      runId: stubRunId,
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
    const report = await runCollection({ settings: stubSettings, runId: stubRunId, collectors: [collector] });
    expect(report.warnings).toHaveLength(2);
    expect(report.warnings).toContainEqual({
      collector: "lever",
      message: "board returned a partial page",
    });
  });
});

describe("the orchestrator takes its run id from its caller and mints none itself", () => {
  test("the orchestrator's source contains no randomUUID call", () => {
    const orchestratorPath = join(dirname(fileURLToPath(import.meta.url)), "search-orchestrator.ts");
    const source = readFileSync(orchestratorPath, "utf-8");
    expect(source).not.toContain("randomUUID");
  });
});
