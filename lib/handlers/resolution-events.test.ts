import { describe, expect, test } from "vitest";
import { fakeResolutionPage, type ScriptedPage } from "../resolution-page.fake";
import type { OpenPage } from "../resolution-page";
import type { JobListEntry } from "../job-list-entry";
import type { TraceEvent, TraceService } from "../trace-service";
import { resolveJobs } from "./resolution";

// Covers only the trace rows the step writes. What it writes back onto each
// entry keeps its own coverage in resolution.test.ts and is not re-asserted
// here.

const RUN_ID = "run-1";
const STEP = "resolution";

// Settling is its own module with its own tests, so every job's resolution here is
// scripted as an already-finished page.
const NO_WAIT = async () => {};

// A link a page offers, worded so the apply-link filter keeps it.
function applyLink(href: string): string {
  return `<a href="${href}">Apply</a>`;
}

function factoryFor(script: ScriptedPage[]): () => Promise<OpenPage> {
  return async () => ({
    page: fakeResolutionPage(script),
    close: async () => {},
  });
}

function job(id: string, fields: Partial<JobListEntry> = {}): JobListEntry {
  return {
    id,
    original_url: "https://board.example/listing/1",
    collector: "adzuna",
    ...fields,
  };
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

// Runs one job through the step with a trace attached and hands back what it
// wrote, since every test below asks the same question of a different resolution.
async function traceOf(
  script: ScriptedPage[],
  entry: JobListEntry = job("a")
): Promise<TraceEvent[]> {
  const trace = createFakeTraceService();
  await resolveJobs([entry], {
    openPage: factoryFor(script),
    concurrency: 1,
    waitForLoad: NO_WAIT,
    trace,
    runId: RUN_ID,
    step: STEP,
  });
  return trace.events;
}

// Four pages each offering somewhere further to go, so resolution spends its
// whole budget. The link left unfollowed on the fourth decides the outcome:
// on the same host resolution already stands on the posting, off it the posting
// sits somewhere resolution never reached.
function pageLimitScript(lastLink: string): ScriptedPage[] {
  return [
    { url: "https://a.example/1", html: applyLink("https://b.example/2") },
    { url: "https://b.example/2", html: applyLink("https://c.example/3") },
    { url: "https://c.example/3", html: applyLink("https://d.example/4") },
    { url: "https://d.example/4", html: applyLink(lastLink) },
  ];
}

describe("AC 25, 30: the rule that accepted a resolution is named", () => {
  test("a page offering nothing to follow reads no_apply_links", async () => {
    const events = await traceOf([
      { url: "https://employer.example/careers/9", html: "<p>A job posting</p>" },
    ]);

    expect(events.map((event) => [event.event, event.reason])).toEqual([
      ["job_resolved", "no_apply_links"],
    ]);
  });

  test("a job's resolution that left its host reads link_left_site", async () => {
    const events = await traceOf([
      { url: "https://board.example/listing/1", html: applyLink("https://employer.example/9") },
      { url: "https://employer.example/9", html: "<p>A job posting</p>" },
    ]);

    expect(events.map((event) => [event.event, event.reason])).toEqual([
      ["job_resolved", "link_left_site"],
    ]);
  });

  test("a page dropped for never leaving its host reads stayed_on_site", async () => {
    const events = await traceOf([
      { url: "https://board.example/listing/1", html: applyLink("https://board.example/apply/1") },
      { url: "https://board.example/apply/1", html: "<p>An application form</p>" },
    ]);

    expect(events.map((event) => [event.event, event.reason])).toEqual([
      ["job_resolved", "stayed_on_site"],
    ]);
  });
});

describe("AC 9, 10, 35: every way a job's resolution can fail has a name", () => {
  test("a page that refuses reads page_refused", async () => {
    const events = await traceOf([
      {
        url: "https://board.example/listing/1",
        responses: [{ url: "https://board.example/listing/1", status: 403 }],
      },
    ]);

    expect(events.map((event) => [event.event, event.reason])).toEqual([
      ["resolution_failed", "page_refused"],
    ]);
  });

  test("a page that is gone reads page_unavailable", async () => {
    const events = await traceOf([
      {
        url: "https://board.example/listing/1",
        responses: [{ url: "https://board.example/listing/1", status: 404 }],
      },
    ]);

    expect(events.map((event) => [event.event, event.reason])).toEqual([
      ["resolution_failed", "page_unavailable"],
    ]);
  });

  test("a page the browser cannot load reads page_load_failed", async () => {
    const events = await traceOf([{ url: "https://board.example/listing/1", failsToLoad: true }]);

    expect(events.map((event) => [event.event, event.reason])).toEqual([
      ["resolution_failed", "page_load_failed"],
    ]);
  });

  test("an off-host dead end reads dead_end", async () => {
    const events = await traceOf([
      { url: "https://board.example/listing/1", html: applyLink("https://elsewhere.example/7") },
      {
        url: "https://elsewhere.example/7",
        html: '<form><input type="password" name="pw" /></form>',
      },
    ]);

    expect(events.map((event) => [event.event, event.reason])).toEqual([
      ["resolution_failed", "dead_end"],
    ]);
  });
});

// One population split by outcome, which is what lets a single query answer
// how often four pages is the binding constraint.
describe("AC 42: the page ceiling is counted whichever way resolution ended", () => {
  test("a budget spent with a same-host link left over reads job_resolved", async () => {
    const events = await traceOf(pageLimitScript("https://d.example/5"));

    expect(events.map((event) => [event.event, event.reason])).toEqual([
      ["job_resolved", "page_limit_reached"],
    ]);
  });

  test("a budget spent with an off-host link left over reads resolution_failed", async () => {
    const events = await traceOf(pageLimitScript("https://e.example/5"));

    expect(events.map((event) => [event.event, event.reason])).toEqual([
      ["resolution_failed", "page_limit_reached"],
    ]);
  });
});

describe("AC 18, 20: a job's resolution that reached a blacklisted host", () => {
  const blacklisted: ScriptedPage[] = [
    { url: "https://www.jobleads.com/jobs/1", html: "<p>A job posting</p>" },
  ];

  // abandoned is the word for a job leaving the pipeline, whether or not a
  // row went with it.
  test("a collected job reads abandoned", async () => {
    const events = await traceOf(blacklisted);

    expect(events.map((event) => [event.event, event.reason])).toEqual([
      ["abandoned", "blacklisted_url"],
    ]);
  });

  // A hand-entered job is markUnresolvable rather than dropped, so it has not left the
  // pipeline and abandoned would be a lie.
  test("a hand-entered job reads resolution_failed", async () => {
    const events = await traceOf(blacklisted, job("a", { collector: "user" }));

    expect(events.map((event) => [event.event, event.reason])).toEqual([
      ["resolution_failed", "blacklisted_url"],
    ]);
  });
});

describe("the shape of every row this step writes", () => {
  test("carries the run, the job, the step and the collector", async () => {
    const events = await traceOf([
      { url: "https://employer.example/careers/9", html: "<p>A job posting</p>" },
    ]);

    expect(events[0]).toMatchObject({
      run_id: RUN_ID,
      job_id: "a",
      step: STEP,
      collector: "adzuna",
    });
  });

  // All three of the trace, the run id and the step name are needed before a
  // row can be written. A step handed only some of them stays silent, which
  // is what lets the same function run outside a job search.
  test("writes nothing where the step name is missing", async () => {
    const trace = createFakeTraceService();

    await resolveJobs([job("a")], {
      openPage: factoryFor([
        { url: "https://employer.example/careers/9", html: "<p>A job posting</p>" },
      ]),
      concurrency: 1,
      waitForLoad: NO_WAIT,
      trace,
      runId: RUN_ID,
    });

    expect(trace.events).toEqual([]);
  });
});
