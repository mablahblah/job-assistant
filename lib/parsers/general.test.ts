import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { fakePageFetcher } from "../tools/page-fetcher.fake";
import type { ParseResult } from "./parser";
import { generalParser } from "./general";

const HOST = "careers.northwind.example";
const NOW = new Date("2026-09-25T12:00:00.000Z");

const JOB_DATA_PAGE =
  '<html><head><script type="application/ld+json">' +
  JSON.stringify({
    "@type": "JobPosting",
    datePosted: "2026-09-20",
    jobLocation: { address: { addressLocality: "Austin", addressRegion: "TX" } },
    description: "<p>Read from the job data.</p>",
  }) +
  "</script></head><body><p>Read from the job data.</p></body></html>";

const ARTICLE = [
  "You will lead design for the contract review workspace our legal customers use every day.",
  "Our legal teams spend hours comparing clauses across hundreds of agreements. You will work " +
    "with them to understand where that time goes, and shape the tools that give it back.",
  "You will partner with product and engineering from the first sketch to the shipped feature, " +
    "run research with in-house counsel, and set the patterns the rest of the design team follows.",
  "We are looking for someone with seven or more years of product design experience, a portfolio " +
    "showing complex workflow tools, and comfort presenting work to senior stakeholders.",
];
const TEXT_PAGE =
  "<html><body><main><article><h1>Senior Product Designer</h1><p>Posted 5 days ago</p>" +
  ARTICLE.map((paragraph) => `<p>${paragraph}</p>`).join("") +
  "</article></main></body></html>";

const PLACE_TEXT_PAGE =
  "<html><body><main><article><h1>Senior Product Designer</h1><p>Location: Denver, CO</p>" +
  ARTICLE.map((paragraph) => `<p>${paragraph}</p>`).join("") +
  "</article></main></body></html>";

const EMPTY_PAGE = "<html><body><nav><a href='/'>Home</a></nav><div id='root'></div></body></html>";

const sites = fakePageFetcher({
  [`${HOST}/job-data`]: { body: JOB_DATA_PAGE },
  [`${HOST}/text`]: { body: TEXT_PAGE },
  [`${HOST}/place-text`]: { body: PLACE_TEXT_PAGE },
  [`${HOST}/empty`]: { body: EMPTY_PAGE },
  [`${HOST}/not-found`]: { status: 404, body: "Not found" },
  [`${HOST}/gone`]: { status: 410, body: JOB_DATA_PAGE },
  [`${HOST}/moved`]: { redirectTo: `https://${HOST}/careers?error=true` },
  [`${HOST}/careers?error=true`]: { body: TEXT_PAGE },
  [`${HOST}/refused`]: { status: 403, body: "Forbidden" },
  [`${HOST}/broken`]: { status: 500, body: "Server error" },
});

const link = (path: string) => `https://${HOST}${path}`;
const originalFetch = globalThis.fetch;

beforeAll(async () => {
  await sites.start();
  globalThis.fetch = sites.fetch;
});

afterAll(async () => {
  globalThis.fetch = originalFetch;
  await sites.stop();
});

// A stand-in for the job search's browser: it hands back whatever page it
// was given for a link, and records every link it was asked to read.
function browserHolding(pages: Record<string, string>) {
  const asked: string[] = [];
  return {
    asked,
    readRenderedPage: async (url: string) => {
      asked.push(url);
      const page = pages[url];
      if (page === undefined) throw new Error(`no page for ${url}`);
      return page;
    },
  };
}

const parse = (path: string, pages: Record<string, string> = {}) => {
  const browser = browserHolding(pages);
  const result: Promise<ParseResult> = generalParser.parse({
    url: link(path),
    readRenderedPage: browser.readRenderedPage,
    referenceInstant: NOW,
  });
  return { result, browser };
};

afterEach(() => {
  sites.visits.length = 0;
});

describe("generalParser: the parser names itself", () => {
  test("its name is the one the source priority list uses", () => {
    expect(generalParser.name).toBe("general");
  });
});

describe("generalParser: search-engine job data is read first", () => {
  test("a page's job data gives the job's details", async () => {
    const { result } = parse("/job-data");
    await expect(result).resolves.toMatchObject({
      description: "<p>Read from the job data.</p>",
      raw_location_list: ["Austin, TX"],
    });
  });

  test("no browser is opened when a plain fetch finds job data", async () => {
    const { result, browser } = parse("/job-data");
    await result;
    expect(browser.asked).toEqual([]);
  });
});

describe("generalParser: page text is read where there is no job data", () => {
  test("a page's main text gives the job's details", async () => {
    const { result } = parse("/text");
    const fields = await result;
    expect(fields).toMatchObject({ posting_date: new Date("2026-09-20T12:00:00.000Z") });
    expect("description" in fields ? fields.description : "").toContain(ARTICLE[0]);
  });

  // A place read from loose page text is added to the job's own places,
  // never offered as a replacement for them.
  test("a place in page text is handed back to add, not to replace", async () => {
    const { result } = parse("/place-text");
    const fields = await result;
    expect(fields).toMatchObject({ added_location_list: ["Denver, CO"] });
    expect(fields).not.toHaveProperty("raw_location_list");
  });

  test("no browser is opened when a plain fetch finds job text", async () => {
    const { result, browser } = parse("/text");
    await result;
    expect(browser.asked).toEqual([]);
  });
});

describe("generalParser: a browser is tried only when a plain fetch finds nothing", () => {
  test("a page empty to a plain fetch is read in a browser", async () => {
    const { result, browser } = parse("/empty", { [link("/empty")]: JOB_DATA_PAGE });
    await expect(result).resolves.toMatchObject({ description: "<p>Read from the job data.</p>" });
    expect(browser.asked).toEqual([link("/empty")]);
  });

  test("a page empty in a browser too is dead", async () => {
    const { result } = parse("/empty", { [link("/empty")]: EMPTY_PAGE });
    await expect(result).resolves.toEqual({ dead: true });
  });

  test("with no browser to try, an empty page reads as nothing rather than dead", async () => {
    const result = generalParser.parse({ url: link("/empty"), referenceInstant: NOW });
    await expect(result).resolves.toEqual({});
  });
});

describe("generalParser: only the page decides a posting is dead", () => {
  test("a page answering not found is dead", async () => {
    await expect(parse("/not-found").result).resolves.toEqual({ dead: true });
  });

  test("a page answering gone is dead, whatever job data it carries", async () => {
    await expect(parse("/gone").result).resolves.toEqual({ dead: true });
  });

  test("a page landing on an address announcing an error is dead", async () => {
    await expect(parse("/moved").result).resolves.toEqual({ dead: true });
  });

  test("a gone page is not opened in a browser", async () => {
    const { result, browser } = parse("/not-found");
    await result;
    expect(browser.asked).toEqual([]);
  });
});

describe("generalParser: a refused page is a failure to read, never a dead posting", () => {
  test.each(["/refused", "/broken"])("%s throws", async (path) => {
    await expect(parse(path).result).rejects.toThrow();
  });
});

describe("generalParser: website rules files are not read", () => {
  test("only the job's own page is asked for", async () => {
    await parse("/job-data").result;
    expect(sites.visits.map((visit) => visit.path)).toEqual(["/job-data"]);
  });
});
