import { describe, expect, test } from "vitest";
import type { JobListEntry } from "../job-list-entry";
import type { Parser } from "../parsers/types";
import type { TraceEvent, TraceService } from "../trace-service";
import { parseJobs } from "./parsing";

// Covers only the trace rows the step writes. What it writes back onto each
// entry keeps its own coverage in parsing.test.ts and is not re-asserted here.

const RUN_ID = "run-1";
const STEP = "parsing";
const GREENHOUSE_LINK = "https://boards.greenhouse.io/acme/jobs/1";
const WORKDAY_LINK = "https://meredith.wd5.myworkdayjobs.com/jobs/1";

function job(id: string, fields: Partial<JobListEntry> = {}): JobListEntry {
  return { id, collector: "adzuna", resolved_url: GREENHOUSE_LINK, ...fields };
}

function stubParser(name: string, parse: Parser["parse"]): Parser {
  return { name, parse };
}

const READING_PARSER = stubParser("greenhouse", async () => ({ raw_title: "Designer" }));
const EMPTY_PARSER = stubParser("greenhouse", async () => ({}));
const THROWING_PARSER = stubParser("greenhouse", async () => {
  throw new Error("the board refused the request");
});

function always(parser: Parser | null) {
  return () => parser;
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
    async countsForRun() {
      return [];
    },
    failureCount() {
      return 0;
    },
  };
}

async function rowsFor(entry: JobListEntry, parser: Parser | null): Promise<TraceEvent[]> {
  const trace = createFakeTraceService();
  await parseJobs([entry], { parserFor: always(parser), trace, runId: RUN_ID, step: STEP });
  return trace.events;
}

describe("AC 36: a job a parser read earns a job_parsed row", () => {
  test("the row names the run, the job, the step and the collector", async () => {
    const [row] = await rowsFor(job("a"), READING_PARSER);

    expect(row).toMatchObject({
      run_id: RUN_ID,
      job_id: "a",
      step: STEP,
      event: "job_parsed",
      collector: "adzuna",
    });
  });

  test("a read that succeeded carries no reason", async () => {
    const [row] = await rowsFor(job("a"), READING_PARSER);

    expect(row?.reason).toBeUndefined();
  });
});

describe("AC 37: every kind of parse failure carries its own reason", () => {
  test("no parser for the domain reads as no_parser_for_domain", async () => {
    const [row] = await rowsFor(job("a", { resolved_url: WORKDAY_LINK }), null);

    expect(row).toMatchObject({ event: "parse_failed", reason: "no_parser_for_domain" });
  });

  test("a parser that threw reads as parser_errored", async () => {
    const [row] = await rowsFor(job("a"), THROWING_PARSER);

    expect(row).toMatchObject({ event: "parse_failed", reason: "parser_errored" });
  });

  test("a parser that read nothing reads as nothing_parsed", async () => {
    const [row] = await rowsFor(job("a"), EMPTY_PARSER);

    expect(row).toMatchObject({ event: "parse_failed", reason: "nothing_parsed" });
  });

  test("the three reasons are three distinct words, so a query can tell them apart", async () => {
    const reasons = [
      (await rowsFor(job("a", { resolved_url: WORKDAY_LINK }), null))[0]?.reason,
      (await rowsFor(job("b"), THROWING_PARSER))[0]?.reason,
      (await rowsFor(job("c"), EMPTY_PARSER))[0]?.reason,
    ];

    expect(new Set(reasons).size).toBe(3);
  });
});

describe("AC 38: every parse_failed row carries the owned domain in its own column", () => {
  test.each([
    ["no parser covers the domain", WORKDAY_LINK, null, "myworkdayjobs.com"],
    ["the parser threw", GREENHOUSE_LINK, THROWING_PARSER, "greenhouse.io"],
    ["the parser read nothing", GREENHOUSE_LINK, EMPTY_PARSER, "greenhouse.io"],
  ])("%s", async (_case, link, parser, domain) => {
    const [row] = await rowsFor(job("a", { resolved_url: link }), parser);

    expect(row?.domain).toBe(domain);
  });

  test("every sub-address of one source counts under the same domain", async () => {
    const [boards] = await rowsFor(
      job("a", { resolved_url: "https://boards.greenhouse.io/acme/jobs/1" }),
      THROWING_PARSER
    );
    const [eu] = await rowsFor(
      job("b", { resolved_url: "https://job-boards.eu.greenhouse.io/acme/jobs/1" }),
      THROWING_PARSER
    );

    expect(boards?.domain).toBe(eu?.domain);
  });
});

describe("AC 39: every parse_failed row keeps the full resolved link in detail", () => {
  test.each([
    ["no parser covers the domain", WORKDAY_LINK, null],
    ["the parser threw", GREENHOUSE_LINK, THROWING_PARSER],
    ["the parser read nothing", GREENHOUSE_LINK, EMPTY_PARSER],
  ])("%s", async (_case, link, parser) => {
    const [row] = await rowsFor(job("a", { resolved_url: link }), parser);

    expect(row?.detail).toBe(link);
  });

  test("the link's query string survives, so a failure can be chased back exactly", async () => {
    const link = `${GREENHOUSE_LINK}?utm_source=jobboard`;

    const [row] = await rowsFor(job("a", { resolved_url: link }), THROWING_PARSER);

    expect(row?.detail).toBe(link);
  });
});

describe("AC 40 and 41: a link yielding no owned domain leaves that column empty", () => {
  test("the domain column is empty", async () => {
    const [row] = await rowsFor(job("a", { resolved_url: "historical" }), READING_PARSER);

    expect(row?.domain).toBeUndefined();
  });

  test("the row is still written, naming the failure", async () => {
    const [row] = await rowsFor(job("a", { resolved_url: "historical" }), READING_PARSER);

    expect(row).toMatchObject({ event: "parse_failed", reason: "no_parser_for_domain" });
  });

  test("nothing throws", async () => {
    await expect(rowsFor(job("a", { resolved_url: "historical" }), READING_PARSER)).resolves.toHaveLength(1);
  });
});

describe("a job with nothing to key a record on writes no row", () => {
  test("a job carrying no id is not traced", async () => {
    const trace = createFakeTraceService();

    await parseJobs([{ collector: "adzuna", resolved_url: GREENHOUSE_LINK }], {
      parserFor: always(READING_PARSER),
      trace,
      runId: RUN_ID,
      step: STEP,
    });

    expect(trace.events).toEqual([]);
  });

  test("a job carrying no collector is not traced", async () => {
    const trace = createFakeTraceService();

    await parseJobs([{ id: "a", resolved_url: GREENHOUSE_LINK }], {
      parserFor: always(READING_PARSER),
      trace,
      runId: RUN_ID,
      step: STEP,
    });

    expect(trace.events).toEqual([]);
  });
});

describe("a step handed no run id and no step name stays silent and still works", () => {
  test("no row is written, and the job is still parsed", async () => {
    const trace = createFakeTraceService();

    const { jobs } = await parseJobs([job("a")], { parserFor: always(READING_PARSER), trace });

    expect(trace.events).toEqual([]);
    expect(jobs[0]?.is_parsed).toBe(true);
  });
});
