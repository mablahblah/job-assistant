import { describe, expect, test } from "vitest";
import type { JobListEntry } from "../types/job-list-entry";
import type { Parser, ParseResult } from "../parsers/parser";
import { parseJobs } from "./parsing";

type ParserContextSeen = Parameters<Parser["parse"]>[0];

const GREENHOUSE_LINK = "https://boards.greenhouse.io/acme/jobs/1";
const WORKDAY_LINK = "https://meredith.wd5.myworkdayjobs.com/jobs/1";

function job(id: string, fields: Partial<JobListEntry> = {}): JobListEntry {
  return { id, collector: "adzuna", resolved_url: GREENHOUSE_LINK, ...fields };
}

// A stand-in parser, so nothing here reaches a job board.
function stubParser(name: string, parse: Parser["parse"]): Parser {
  return { name, parse };
}

const readingParser = stubParser("greenhouse", async () => ({
  raw_title: "Senior Product Designer",
  raw_company_name: "Acme",
}));

// Hands every job the same parser, whatever its link.
function always(parser: Parser<ParseResult> | null) {
  return () => parser;
}

// A stand-in for the general parser every failed or unowned job is handed
// to, so nothing here fetches a page. It records every link it was asked for.
function fallback(parse: Parser<ParseResult>["parse"]) {
  const asked: string[] = [];
  const parser: Parser<ParseResult> = {
    name: "general",
    parse: async (context) => {
      asked.push(context.url);
      return parse(context);
    },
  };
  return { parser, asked };
}

const fallbackReads = fallback(async () => ({ description: "Read from the page." }));
const fallbackRefused = () =>
  fallback(async () => {
    throw new Error("the page refused the request");
  });

describe("a job whose owned domain has a parser is read by it", () => {
  test("AC 34: a parse returning one field or more marks the job parsed", async () => {
    const { jobs } = await parseJobs([job("a")], { parserFor: always(readingParser) });

    expect(jobs[0]?.is_parsed).toBe(true);
  });

  test("the fields the parse found are written onto the entry", async () => {
    const { jobs } = await parseJobs([job("a")], { parserFor: always(readingParser) });

    expect(jobs[0]?.raw_title).toBe("Senior Product Designer");
    expect(jobs[0]?.raw_company_name).toBe("Acme");
  });

  test("AC 18: the parser names itself, so save can weigh it against a collector", async () => {
    const { jobs } = await parseJobs([job("a")], { parserFor: always(readingParser) });

    expect(jobs[0]?.parser).toBe("greenhouse");
  });

  test("a parse never overwrites the resolved link it was handed", async () => {
    const { jobs } = await parseJobs([job("a")], { parserFor: always(readingParser) });

    expect(jobs[0]?.resolved_url).toBe(GREENHOUSE_LINK);
  });

  test("the job keeps whatever status it already had", async () => {
    const { jobs } = await parseJobs([job("a", { status: "backlog" })], {
      parserFor: always(readingParser),
    });

    expect(jobs[0]?.status).toBe("backlog");
  });

  test("AC 34: a parse returning only a title is a success, not a thin read", async () => {
    const thin = stubParser("greenhouse", async () => ({ raw_title: "Designer" }));

    const { jobs } = await parseJobs([job("a")], { parserFor: always(thin) });

    expect(jobs[0]?.is_parsed).toBe(true);
  });

  test("the parser is handed the resolved link, not the original one", async () => {
    const seen: string[] = [];
    const recording = stubParser("greenhouse", async ({ url }) => {
      seen.push(url);
      return { raw_title: "Designer" };
    });

    await parseJobs([job("a", { original_url: "https://www.adzuna.com/details/1" })], {
      parserFor: always(recording),
    });

    expect(seen).toEqual([GREENHOUSE_LINK]);
  });
});

describe("a job no dedicated parser covers is handed to the general parser", () => {
  test("the general parser reads it", async () => {
    const general = fallback(async () => ({ description: "Read from the page." }));

    const { jobs } = await parseJobs([job("a", { resolved_url: WORKDAY_LINK })], {
      parserFor: always(null),
      fallbackParser: general.parser,
    });

    expect(general.asked).toEqual([WORKDAY_LINK]);
    expect(jobs[0]?.description).toBe("Read from the page.");
  });
});

describe("a job with no web link is judged on what its collector found, with no fetch", () => {
  test("no parser is asked to read it", async () => {
    const general = fallbackRefused();

    await parseJobs([job("a", { resolved_url: null, raw_location_list: ["Austin, TX"] })], {
      parserFor: always(readingParser),
      fallbackParser: general.parser,
    });

    expect(general.asked).toEqual([]);
  });

  test("with a collector place it stays where it was, marked read", async () => {
    const { jobs } = await parseJobs(
      [job("a", { resolved_url: null, status: "backlog", raw_location_list: ["Austin, TX"] })],
      { parserFor: always(readingParser), fallbackParser: fallbackRefused().parser }
    );

    expect(jobs[0]?.status).toBe("backlog");
    expect(jobs[0]?.is_parsed).toBe(true);
  });

  test("with no place it is set aside", async () => {
    const { jobs } = await parseJobs([job("a", { resolved_url: "historical" })], {
      parserFor: always(readingParser),
      fallbackParser: fallbackRefused().parser,
    });

    expect(jobs[0]?.status).toBe("unparseable");
    expect(jobs[0]?.is_parsed).toBe(false);
  });

  test("the step does not throw", async () => {
    await expect(
      parseJobs([job("a", { resolved_url: "historical" })], {
        parserFor: always(readingParser),
        fallbackParser: fallbackRefused().parser,
      })
    ).resolves.toBeDefined();
  });
});

describe("a dedicated parser that fails hands the job to the general parser", () => {
  const throwing = stubParser("greenhouse", async () => {
    throw new Error("the board refused the request");
  });
  const empty = stubParser("greenhouse", async () => ({}));

  test.each([
    ["threw", throwing],
    ["read nothing", empty],
  ])("a dedicated parser that %s is followed by the general parser", async (_case, dedicated) => {
    const general = fallback(async () => ({ description: "Read from the page." }));

    const { jobs } = await parseJobs([job("a", { raw_location_list: ["Austin, TX"] })], {
      parserFor: always(dedicated),
      fallbackParser: general.parser,
    });

    expect(general.asked).toEqual([GREENHOUSE_LINK]);
    expect(jobs[0]?.description).toBe("Read from the page.");
    expect(jobs[0]?.parser).toBe("general");
    expect(jobs[0]?.is_parsed).toBe(true);
  });

  test("a dedicated parser that read something is not followed", async () => {
    const general = fallback(async () => ({ description: "Read from the page." }));

    await parseJobs([job("a")], { parserFor: always(readingParser), fallbackParser: general.parser });

    expect(general.asked).toEqual([]);
  });

  // A dedicated parser's own read keeps today's location rule: a job it read
  // is never set aside for lacking a place.
  test("a job a dedicated parser read keeps its status with no place", async () => {
    const remote = stubParser("greenhouse", async () => ({ raw_location_list: ["Remote"] }));

    const { jobs } = await parseJobs([job("a", { status: "backlog" })], {
      parserFor: always(remote),
      fallbackParser: fallbackRefused().parser,
    });

    expect(jobs[0]?.status).toBe("backlog");
    expect(jobs[0]?.is_parsed).toBe(true);
  });
});

describe("the general parser's answer decides the job's outcome", () => {
  test("a dead page expires the job", async () => {
    const dead = fallback(async () => ({ dead: true as const }));

    const { jobs } = await parseJobs([job("a", { status: "backlog", raw_location_list: ["Austin, TX"] })], {
      parserFor: always(dead.parser),
      fallbackParser: dead.parser,
    });

    expect(jobs[0]?.status).toBe("expired");
    expect(jobs[0]).not.toHaveProperty("dead");
  });

  test("a read with a place keeps the job where it was, marked read", async () => {
    const { jobs } = await parseJobs([job("a", { status: "backlog", raw_location_list: ["Austin, TX"] })], {
      parserFor: always(fallbackReads.parser),
      fallbackParser: fallbackReads.parser,
    });

    expect(jobs[0]?.status).toBe("backlog");
    expect(jobs[0]?.is_parsed).toBe(true);
  });

  test("a read that leaves the job with no place sets it aside", async () => {
    const { jobs } = await parseJobs([job("a", { status: "backlog" })], {
      parserFor: always(fallbackReads.parser),
      fallbackParser: fallbackReads.parser,
    });

    expect(jobs[0]?.status).toBe("unparseable");
    expect(jobs[0]?.is_parsed).toBe(false);
  });

  test("a refused page falls back to the collector's place, never expiring the job", async () => {
    const refused = fallbackRefused();

    const { jobs } = await parseJobs([job("a", { status: "backlog", raw_location_list: ["Austin, TX"] })], {
      parserFor: always(refused.parser),
      fallbackParser: refused.parser,
    });

    expect(jobs[0]?.status).toBe("backlog");
    expect(jobs[0]?.is_parsed).toBe(true);
  });

  test("a place of only \"Remote\" or punctuation counts as no place", async () => {
    const refused = fallbackRefused();

    const { jobs } = await parseJobs(
      [
        job("a", { status: "backlog", raw_location_list: ["Remote"] }),
        job("b", { status: "backlog", raw_location_list: [", "] }),
      ],
      { parserFor: always(refused.parser), fallbackParser: refused.parser }
    );

    expect(jobs.map((entry) => entry.status)).toEqual(["unparseable", "unparseable"]);
  });

  test("a place read from page text is added to the job's places", async () => {
    const adding = fallback(async () => ({ added_location_list: ["Denver, CO"] }));

    const { jobs } = await parseJobs([job("a", { raw_location_list: ["Austin, TX"] })], {
      parserFor: always(adding.parser),
      fallbackParser: adding.parser,
    });

    expect(jobs[0]?.raw_location_list).toEqual(["Austin, TX", "Denver, CO"]);
    expect(jobs[0]).not.toHaveProperty("added_location_list");
  });
});

describe("every parser is handed the search's browser and start time", () => {
  test("both arrive beside the link", async () => {
    const seen: ParserContextSeen[] = [];
    const recording = stubParser("greenhouse", async (context) => {
      seen.push(context);
      return { raw_title: "Designer" };
    });
    const readRenderedPage = async () => "<html></html>";
    const referenceInstant = new Date("2026-09-25T12:00:00.000Z");

    await parseJobs([job("a")], {
      parserFor: always(recording),
      fallbackParser: fallbackRefused().parser,
      readRenderedPage,
      referenceInstant,
    });

    expect(seen[0]?.readRenderedPage).toBe(readRenderedPage);
    expect(seen[0]?.referenceInstant).toBe(referenceInstant);
  });
});

describe("AC 35: one job's failure costs that job alone", () => {
  test("every job after a throwing one is still read", async () => {
    const byId = (url: string) =>
      url.includes("boom")
        ? stubParser("greenhouse", async () => {
            throw new Error("boom");
          })
        : readingParser;

    const { jobs } = await parseJobs(
      [
        job("a"),
        job("b", { resolved_url: "https://boards.greenhouse.io/acme/jobs/boom" }),
        job("c"),
      ],
      { parserFor: byId, fallbackParser: fallbackRefused().parser }
    );

    expect(jobs.map((entry) => entry.is_parsed)).toEqual([true, false, true]);
  });

  test("the list comes back in the order it went in", async () => {
    const { jobs } = await parseJobs([job("a"), job("b"), job("c")], {
      parserFor: always(readingParser),
    });

    expect(jobs.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });
});

describe("the step returns the list and its warnings, as every handler does", () => {
  test("an empty list gives an empty list back", async () => {
    await expect(parseJobs([], { parserFor: always(readingParser) })).resolves.toEqual({
      jobs: [],
      warnings: [],
    });
  });
});
