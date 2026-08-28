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

// A minimal job. Every JobListEntry field is optional, so a url and a title
// are enough to tell one job from another.
function makeJob(title: string): JobListEntry {
  return { original_url: `https://example.com/${title}`, raw_title: title };
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
    const report = await runCollection({ settings: stubSettings, collectors: [failing] });
    expect(report.errors).toEqual([{ collector: "greenhouse", message: "board unreachable" }]);
  });

  test("a collector listed after the failing one still runs", async () => {
    const failing = makeThrowingCollector("greenhouse", "board unreachable");
    const later = makeCollector("lever", emptyResult);
    await runCollection({ settings: stubSettings, collectors: [failing, later] });
    expect(later.wasCalled).toBe(true);
  });

  test("runCollection resolves rather than rejecting", async () => {
    const failing = makeThrowingCollector("greenhouse", "board unreachable");
    await expect(
      runCollection({ settings: stubSettings, collectors: [failing] })
    ).resolves.toBeDefined();
  });
});

describe("AC 16: a warning keeps the collector that produced it", () => {
  test("the warning's collector is the collector's name", async () => {
    const collector = makeCollector("greenhouse", {
      jobs: [],
      errors: [],
      warnings: ["stripe: board returned no postings"],
    });
    const report = await runCollection({ settings: stubSettings, collectors: [collector] });
    expect(report.warnings[0]?.collector).toBe("greenhouse");
  });

  test("the warning's message is the collector's string, unchanged", async () => {
    // The collector's own words are what name the board or search, so they
    // must survive intact — no rewriting, no truncation.
    const message = "stripe: board returned no postings";
    const collector = makeCollector("greenhouse", { jobs: [], errors: [], warnings: [message] });
    const report = await runCollection({ settings: stubSettings, collectors: [collector] });
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
    const report = await runCollection({ settings: stubSettings, collectors });
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
    await runCollection({ settings: stubSettings, collectors: [collector], limit: 0 });
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
    await runCollection({ settings: stubSettings, collectors: [first, second], limit: 1 });
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
    const report = await runCollection({ settings: stubSettings, collectors: [collector] });
    expect(report.jobs[0]?.collector).toBe("lever");
  });

  test("a job naming a different collector is overwritten with the true one", async () => {
    const collector = makeCollector("lever", {
      jobs: [{ ...makeJob("Designer"), collector: "lever-api" }],
      errors: [],
      warnings: [],
    });
    const report = await runCollection({ settings: stubSettings, collectors: [collector] });
    expect(report.jobs[0]?.collector).toBe("lever");
  });
});

describe("an omitted limit means collect everything", () => {
  test("context.limit is Infinity when no limit is supplied", async () => {
    const collector = makeCollector("dribbble", emptyResult);
    await runCollection({ settings: stubSettings, collectors: [collector] });
    expect(collector.contextReceived?.limit).toBe(Infinity);
  });
});

describe("the settings service reaches every collector", () => {
  test("context.settings is the instance handed to runCollection", async () => {
    const collector = makeCollector("dribbble", emptyResult);
    await runCollection({ settings: stubSettings, collectors: [collector] });
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
    await runCollection({ settings: stubSettings, collectors: [first, second] });
    expect(order).toEqual(["first", "second"]);
  });

  test("their job lists are concatenated in that order", async () => {
    const first = makeCollector("first", { jobs: [makeJob("Designer")], errors: [], warnings: [] });
    const second = makeCollector("second", {
      jobs: [makeJob("Researcher")],
      errors: [],
      warnings: [],
    });
    const report = await runCollection({ settings: stubSettings, collectors: [first, second] });
    expect(report.jobs.map((job) => job.raw_title)).toEqual(["Designer", "Researcher"]);
  });
});
