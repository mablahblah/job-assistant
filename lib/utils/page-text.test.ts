import { describe, expect, test } from "vitest";
import { jobFieldsFromPageText } from "./page-text";

// The moment a relative date such as "3 days ago" is counted back from.
const NOW = new Date("2026-09-25T12:00:00.000Z");

// A description long enough to read as a page's main article, the way a real
// posting's is.
const ARTICLE = [
  "You will lead design for the contract review workspace our legal customers use every day.",
  "Our legal teams spend hours comparing clauses across hundreds of agreements. You will work " +
    "with them to understand where that time goes, and shape the tools that give it back.",
  "You will partner with product and engineering from the first sketch to the shipped feature, " +
    "run research with in-house counsel, and set the patterns the rest of the design team follows.",
  "We are looking for someone with seven or more years of product design experience, a portfolio " +
    "showing complex workflow tools, and comfort presenting work to senior stakeholders.",
];

// A job page shown as ordinary text: the site's frame around one article,
// with any extra lines placed above the description.
function jobPage(lines: string[] = []): string {
  return (
    "<!DOCTYPE html><html><head><title>Senior Product Designer</title></head><body>" +
    "<header><nav><a href='/'>Home</a> <a href='/jobs'>Browse all jobs</a></nav></header>" +
    "<main><article><h1>Senior Product Designer</h1>" +
    lines.map((line) => `<p>${line}</p>`).join("") +
    ARTICLE.map((paragraph) => `<p>${paragraph}</p>`).join("") +
    "</article></main><footer><p>Copyright Quillsoft, Inc.</p></footer></body></html>"
  );
}

describe("jobFieldsFromPageText: a page with no job text", () => {
  test("a page holding only its site's frame answers nothing", () => {
    const empty =
      "<!DOCTYPE html><html><head><title>Quillsoft</title></head><body>" +
      "<nav><a href='/'>Home</a> <a href='/careers'>Careers</a></nav><div id='root'></div></body></html>";
    expect(jobFieldsFromPageText(empty, NOW)).toBeNull();
  });
});

describe("jobFieldsFromPageText: the description is the page's main article", () => {
  test("the article's text is the description", () => {
    expect(jobFieldsFromPageText(jobPage(), NOW)?.description ?? "").toContain(ARTICLE[0]);
  });

  test("the site's menu and footer are left out", () => {
    const description = jobFieldsFromPageText(jobPage(), NOW)?.description ?? "";
    expect(description).not.toContain("Browse all jobs");
    expect(description).not.toContain("Copyright Quillsoft");
  });
});

describe("jobFieldsFromPageText: a posted date is read only where it is labelled", () => {
  test.each([
    ["Posted: Aug 28, 2026", "2026-08-28T00:00:00.000Z"],
    ["Posted on September 4, 2026", "2026-09-04T00:00:00.000Z"],
    ["Date posted: 2026-08-28", "2026-08-28T00:00:00.000Z"],
    ["Posting Date 09/22/2026", "2026-09-22T00:00:00.000Z"],
  ])("%s", (line, expected) => {
    expect(jobFieldsFromPageText(jobPage([line]), NOW)?.posting_date?.toISOString()).toBe(expected);
  });

  test("a posted date given as an age is counted back from now", () => {
    expect(jobFieldsFromPageText(jobPage(["Posted 3 days ago"]), NOW)?.posting_date?.toISOString()).toBe(
      "2026-09-22T12:00:00.000Z"
    );
  });

  test("a date with no label beside it is not read", () => {
    expect(jobFieldsFromPageText(jobPage(["Aug 28, 2026"]), NOW)).not.toHaveProperty("posting_date");
  });

  test("a labelled date that cannot be read as a date is left out", () => {
    expect(jobFieldsFromPageText(jobPage(["Posted: Coming soon"]), NOW)).not.toHaveProperty("posting_date");
  });
});

describe("jobFieldsFromPageText: an updated date is read only where it is labelled", () => {
  test.each([
    ["Updated: Aug 30, 2026", "2026-08-30T00:00:00.000Z"],
    ["Last updated August 30, 2026", "2026-08-30T00:00:00.000Z"],
  ])("%s", (line, expected) => {
    expect(jobFieldsFromPageText(jobPage([line]), NOW)?.posting_updated_date?.toISOString()).toBe(expected);
  });

  test("an updated date given as an age is counted back from now", () => {
    expect(
      jobFieldsFromPageText(jobPage(["Updated 6 days ago"]), NOW)?.posting_updated_date?.toISOString()
    ).toBe("2026-09-19T12:00:00.000Z");
  });

  test("a labelled updated date that cannot be read as a date is left out", () => {
    expect(jobFieldsFromPageText(jobPage(["Updated: TBD"]), NOW)).not.toHaveProperty("posting_updated_date");
  });

  test("an updated date is not taken for the posted date", () => {
    expect(jobFieldsFromPageText(jobPage(["Updated: Aug 30, 2026"]), NOW)).not.toHaveProperty("posting_date");
  });
});

describe("jobFieldsFromPageText: the work mode is read from wording about the role", () => {
  test("a role described as hybrid is hybrid", () => {
    expect(jobFieldsFromPageText(jobPage(["This is a hybrid role."]), NOW)?.raw_mode_list).toEqual(["hybrid"]);
  });

  test("talk about the company's remote teams names no mode", () => {
    const fields = jobFieldsFromPageText(jobPage(["Our remote teams span four time zones."]), NOW);
    expect(fields?.raw_mode_list ?? []).toEqual([]);
  });
});

describe("jobFieldsFromPageText: a place is read only where it is labelled", () => {
  test("a labelled location is a place", () => {
    expect(jobFieldsFromPageText(jobPage(["Location: Denver, CO"]), NOW)?.raw_location_list).toEqual([
      "Denver, CO",
    ]);
  });

  test("a place with no label beside it is not read", () => {
    expect(jobFieldsFromPageText(jobPage(["Denver, CO"]), NOW)?.raw_location_list ?? []).toEqual([]);
  });
});
