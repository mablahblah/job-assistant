import { describe, expect, test } from "vitest";
import type { JobListEntry } from "../types/job-list-entry";
import type { Parser } from "../parsers/parser";
import { parseJobs } from "./parsing";

const GREENHOUSE_LINK = "https://boards.greenhouse.io/acme/jobs/1";
const WORKDAY_LINK = "https://meredith.wd5.myworkdayjobs.com/jobs/1";

function job(id: string, fields: Partial<JobListEntry> = {}): JobListEntry {
  return { id, collector: "adzuna", resolved_url: GREENHOUSE_LINK, ...fields };
}

// A stand-in parser, so nothing here reaches a job board.
function stubParser(name: string, parse: Parser["parse"]): Parser {
  return { name, parse };
}

const READING_PARSER = stubParser("greenhouse", async () => ({
  raw_title: "Senior Product Designer",
  raw_company_name: "Acme",
}));

// Hands every job the same parser, whatever its link.
function always(parser: Parser | null) {
  return () => parser;
}

describe("a job whose owned domain has a parser is read by it", () => {
  test("AC 34: a parse returning one field or more marks the job parsed", async () => {
    const { jobs } = await parseJobs([job("a")], { parserFor: always(READING_PARSER) });

    expect(jobs[0]?.is_parsed).toBe(true);
  });

  test("the fields the parse found are written onto the entry", async () => {
    const { jobs } = await parseJobs([job("a")], { parserFor: always(READING_PARSER) });

    expect(jobs[0]?.raw_title).toBe("Senior Product Designer");
    expect(jobs[0]?.raw_company_name).toBe("Acme");
  });

  test("AC 18: the parser names itself, so save can weigh it against a collector", async () => {
    const { jobs } = await parseJobs([job("a")], { parserFor: always(READING_PARSER) });

    expect(jobs[0]?.parser).toBe("greenhouse");
  });

  test("a parse never overwrites the resolved link it was handed", async () => {
    const { jobs } = await parseJobs([job("a")], { parserFor: always(READING_PARSER) });

    expect(jobs[0]?.resolved_url).toBe(GREENHOUSE_LINK);
  });

  test("the job keeps whatever status it already had", async () => {
    const { jobs } = await parseJobs([job("a", { status: "backlog" })], {
      parserFor: always(READING_PARSER),
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

describe("AC 28 and 29: a job no parser covers leaves the queue", () => {
  test("it takes unparseable", async () => {
    const { jobs } = await parseJobs([job("a", { resolved_url: WORKDAY_LINK })], {
      parserFor: always(null),
    });

    expect(jobs[0]?.status).toBe("unparseable");
  });

  test("its parsed flag stays false", async () => {
    const { jobs } = await parseJobs([job("a", { resolved_url: WORKDAY_LINK })], {
      parserFor: always(null),
    });

    expect(jobs[0]?.is_parsed).toBe(false);
  });

  test("AC 23: nothing is read from its description", async () => {
    const { jobs } = await parseJobs(
      [
        job("a", {
          resolved_url: WORKDAY_LINK,
          description: "This role is remote. The range is $120,000 - $150,000 per year.",
        }),
      ],
      { parserFor: always(null) }
    );

    expect(jobs[0]?.raw_mode_list).toBeUndefined();
    expect(jobs[0]?.raw_salary).toBeUndefined();
  });
});

describe("AC 6 and 7: a resolved link that is not a web address stops that job alone", () => {
  test("the job takes unparseable", async () => {
    const { jobs } = await parseJobs([job("a", { resolved_url: "historical" })], {
      parserFor: always(READING_PARSER),
    });

    expect(jobs[0]?.status).toBe("unparseable");
  });

  test("the step does not throw", async () => {
    await expect(
      parseJobs([job("a", { resolved_url: "historical" })], { parserFor: always(READING_PARSER) })
    ).resolves.toBeDefined();
  });

  test("a job carrying no resolved link at all takes unparseable too", async () => {
    const { jobs } = await parseJobs([job("a", { resolved_url: null })], {
      parserFor: always(READING_PARSER),
    });

    expect(jobs[0]?.status).toBe("unparseable");
  });
});

describe("AC 30 and 31: a parse that threw leaves the job where it was", () => {
  const throwing = stubParser("greenhouse", async () => {
    throw new Error("the board refused the request");
  });

  test("the job keeps backlog", async () => {
    const { jobs } = await parseJobs([job("a", { status: "backlog" })], {
      parserFor: always(throwing),
    });

    expect(jobs[0]?.status).toBe("backlog");
  });

  test("its parsed flag stays false", async () => {
    const { jobs } = await parseJobs([job("a")], { parserFor: always(throwing) });

    expect(jobs[0]?.is_parsed).toBe(false);
  });
});

describe("AC 32 and 33: a parse that found nothing leaves the job where it was", () => {
  const empty = stubParser("greenhouse", async () => ({}));

  test("the job keeps backlog", async () => {
    const { jobs } = await parseJobs([job("a", { status: "backlog" })], {
      parserFor: always(empty),
    });

    expect(jobs[0]?.status).toBe("backlog");
  });

  test("its parsed flag stays false", async () => {
    const { jobs } = await parseJobs([job("a")], { parserFor: always(empty) });

    expect(jobs[0]?.is_parsed).toBe(false);
  });

  test("no parser name is written onto a job nothing was read from", async () => {
    const { jobs } = await parseJobs([job("a")], { parserFor: always(empty) });

    expect(jobs[0]?.parser).toBeUndefined();
  });
});

describe("AC 35: one job's failure costs that job alone", () => {
  test("every job after a throwing one is still read", async () => {
    const byId = (url: string) =>
      url.includes("boom")
        ? stubParser("greenhouse", async () => {
            throw new Error("boom");
          })
        : READING_PARSER;

    const { jobs } = await parseJobs(
      [
        job("a"),
        job("b", { resolved_url: "https://boards.greenhouse.io/acme/jobs/boom" }),
        job("c"),
      ],
      { parserFor: byId }
    );

    expect(jobs.map((entry) => entry.is_parsed)).toEqual([true, false, true]);
  });

  test("the list comes back in the order it went in", async () => {
    const { jobs } = await parseJobs([job("a"), job("b"), job("c")], {
      parserFor: always(READING_PARSER),
    });

    expect(jobs.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });
});

describe("the step returns the list and its warnings, as every handler does", () => {
  test("an empty list gives an empty list back", async () => {
    await expect(parseJobs([], { parserFor: always(READING_PARSER) })).resolves.toEqual({
      jobs: [],
      warnings: [],
    });
  });
});
