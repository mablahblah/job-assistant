import { describe, expect, test } from "vitest";
import type { JobListEntry } from "../types/job-list-entry";
import type { Parser, ParseResult } from "../parsers/parser";
import type { TraceEvent, TraceService } from "../services/trace-service";
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

const readingParser = stubParser("greenhouse", async () => ({ raw_title: "Designer" }));
const emptyParser = stubParser("greenhouse", async () => ({}));
const throwingParser = stubParser("greenhouse", async () => {
  throw new Error("the board refused the request");
});

function always(parser: Parser<ParseResult> | null) {
  return () => parser;
}

// Stand-ins for the general parser every failed or unowned job is handed to,
// so nothing here fetches a page.
function generalAnswering(parse: Parser<ParseResult>["parse"]): Parser<ParseResult> {
  return { name: "general", parse };
}
const generalRefused = generalAnswering(async () => {
  throw new Error("the page refused the request");
});
const generalDead = generalAnswering(async () => ({ dead: true as const }));

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

async function rowsFor(
  entry: JobListEntry,
  parser: Parser | null,
  fallbackParser: Parser<ParseResult> = generalRefused
): Promise<TraceEvent[]> {
  const trace = createFakeTraceService();
  await parseJobs([entry], {
    parserFor: always(parser),
    fallbackParser,
    trace,
    runId: RUN_ID,
    step: STEP,
  });
  return trace.events;
}

describe("AC 36: a job a parser read earns a job_parsed row", () => {
  test("the row names the run, the job, the step and the collector", async () => {
    const [row] = await rowsFor(job("a"), readingParser);

    expect(row).toMatchObject({
      run_id: RUN_ID,
      job_id: "a",
      step: STEP,
      event: "job_parsed",
      collector: "adzuna",
    });
  });

  test("a read that succeeded carries no reason", async () => {
    const [row] = await rowsFor(job("a"), readingParser);

    expect(row?.reason).toBeUndefined();
  });
});

// Every reason the pipeline already records at parsing, and the one every
// age-based expiry carries. The two new outcomes must use none of these.
const EXISTING_REASONS = [
  "no_parser_for_domain",
  "parser_errored",
  "nothing_parsed",
  "past_expiration_threshold",
];

describe("a dead page is recorded as a read job with its own reason", () => {
  test("the row is job_parsed, so the summary counts the job as read", async () => {
    const [row] = await rowsFor(job("a"), null, generalDead);

    expect(row).toMatchObject({ event: "job_parsed", reason: "dead_page" });
  });
});

describe("a job left with no place is recorded as not read with its own reason", () => {
  test("the row is parsing_failed with reason no_location", async () => {
    const [row] = await rowsFor(job("a"), null);

    expect(row).toMatchObject({ event: "parsing_failed", reason: "no_location" });
  });

  test("the two new reasons differ from each other and from every existing one", async () => {
    const dead = (await rowsFor(job("a"), null, generalDead))[0]?.reason;
    const noPlace = (await rowsFor(job("b"), null))[0]?.reason;

    expect(dead).not.toBe(noPlace);
    expect(EXISTING_REASONS).not.toContain(dead);
    expect(EXISTING_REASONS).not.toContain(noPlace);
  });
});

describe("a job a dedicated parser failed on leaves parsing once", () => {
  test("a throw then a general read with a place writes one job_parsed row", async () => {
    const rows = await rowsFor(
      job("a", { raw_location_list: ["Austin, TX"] }),
      throwingParser,
      generalAnswering(async () => ({ description: "Read from the page." }))
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ event: "job_parsed" });
  });

  test("an empty read then a refused page with no place writes one parsing_failed row", async () => {
    const rows = await rowsFor(job("a"), emptyParser);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ event: "parsing_failed", reason: "no_location" });
  });
});

describe("a parsing_failed row carries the owned domain in its own column", () => {
  test.each([
    ["a website no dedicated parser covers", WORKDAY_LINK, null, "myworkdayjobs.com"],
    ["a dedicated parser that threw", GREENHOUSE_LINK, throwingParser, "greenhouse.io"],
    ["a dedicated parser that read nothing", GREENHOUSE_LINK, emptyParser, "greenhouse.io"],
  ])("%s", async (_case, link, parser, domain) => {
    const [row] = await rowsFor(job("a", { resolved_url: link }), parser);

    expect(row?.domain).toBe(domain);
  });

  test("every sub-address of one source counts under the same domain", async () => {
    const [boards] = await rowsFor(
      job("a", { resolved_url: "https://boards.greenhouse.io/acme/jobs/1" }),
      throwingParser
    );
    const [eu] = await rowsFor(
      job("b", { resolved_url: "https://job-boards.eu.greenhouse.io/acme/jobs/1" }),
      throwingParser
    );

    expect(boards?.domain).toBe(eu?.domain);
  });
});

describe("a parsing_failed row keeps the full resolved link in detail", () => {
  test.each([
    ["a website no dedicated parser covers", WORKDAY_LINK, null],
    ["a dedicated parser that threw", GREENHOUSE_LINK, throwingParser],
    ["a dedicated parser that read nothing", GREENHOUSE_LINK, emptyParser],
  ])("%s", async (_case, link, parser) => {
    const [row] = await rowsFor(job("a", { resolved_url: link }), parser);

    expect(row?.detail).toBe(link);
  });

  test("the link's query string survives, so a failure can be chased back exactly", async () => {
    const link = `${GREENHOUSE_LINK}?utm_source=jobboard`;

    const [row] = await rowsFor(job("a", { resolved_url: link }), throwingParser);

    expect(row?.detail).toBe(link);
  });
});

describe("a link yielding no owned domain leaves that column empty", () => {
  test("the domain column is empty", async () => {
    const [row] = await rowsFor(job("a", { resolved_url: "historical" }), readingParser);

    expect(row?.domain).toBeUndefined();
  });

  test("the row is still written, naming the missing place", async () => {
    const [row] = await rowsFor(job("a", { resolved_url: "historical" }), readingParser);

    expect(row).toMatchObject({ event: "parsing_failed", reason: "no_location" });
  });

  test("nothing throws", async () => {
    await expect(rowsFor(job("a", { resolved_url: "historical" }), readingParser)).resolves.toHaveLength(1);
  });
});

describe("a job with nothing to key a record on writes no row", () => {
  test("a job carrying no id is not traced", async () => {
    const trace = createFakeTraceService();

    await parseJobs([{ collector: "adzuna", resolved_url: GREENHOUSE_LINK }], {
      parserFor: always(readingParser),
      trace,
      runId: RUN_ID,
      step: STEP,
    });

    expect(trace.events).toEqual([]);
  });

  test("a job carrying no collector is not traced", async () => {
    const trace = createFakeTraceService();

    await parseJobs([{ id: "a", resolved_url: GREENHOUSE_LINK }], {
      parserFor: always(readingParser),
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

    const { jobs } = await parseJobs([job("a")], { parserFor: always(readingParser), trace });

    expect(trace.events).toEqual([]);
    expect(jobs[0]?.is_parsed).toBe(true);
  });
});
