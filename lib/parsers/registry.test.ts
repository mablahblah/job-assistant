import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import fixture from "./resolved-addresses.fixture.json";
import { PARSERS_BY_DOMAIN, parserForUrl } from "./registry";

const DOMAINS = Object.keys(PARSERS_BY_DOMAIN);

describe("AC 1: every owned domain in the registry reaches its own parser", () => {
  test.each(DOMAINS)("%s reaches one parser and no other", (domain) => {
    const matched = parserForUrl(`https://${domain}/jobs/1`);

    expect(matched).toBe(PARSERS_BY_DOMAIN[domain]);
  });

  test("no two domains share a parser, so a match names one source", () => {
    const names = DOMAINS.map((domain) => PARSERS_BY_DOMAIN[domain].name);

    expect(new Set(names).size).toBe(names.length);
  });
});

describe("AC 2: any sub-address of a registered domain reaches that domain's parser", () => {
  test.each([
    ["https://boards.greenhouse.io/acme/jobs/1", "greenhouse"],
    ["https://job-boards.greenhouse.io/acme/jobs/1", "greenhouse"],
    ["https://job-boards.eu.greenhouse.io/acme/jobs/1", "greenhouse"],
    ["https://acme.greenhouse.io/jobs/1", "greenhouse"],
    ["https://jobs.lever.co/acme/1", "lever"],
    ["https://jobs.ashbyhq.com/acme/1", "ashby"],
    ["https://dribbble.com/jobs/1", "dribbble"],
  ])("%s reaches the %s parser", (url, name) => {
    expect(parserForUrl(url)?.name).toBe(name);
  });
});

describe("AC 3: a domain the registry does not name reaches no parser", () => {
  test.each([
    "https://meredith.wd5.myworkdayjobs.com/jobs/1",
    "https://www.adzuna.com/details/1",
    "https://www.linkedin.com/jobs/view/1",
  ])("%s reaches no parser", (url) => {
    expect(parserForUrl(url)).toBeNull();
  });

  test("a link that is not a web address reaches no parser rather than throwing", () => {
    expect(parserForUrl("historical")).toBeNull();
  });
});

describe("AC 5: every resolved-link address the live data holds", () => {
  // The fixture is every distinct address across 2,208 real jobs. Each row
  // names the parser that address must reach, or null where none claims it.
  test.each(fixture.addresses.map((row) => [row.address, row.parser] as const))(
    "%s reaches %s",
    (address, parser) => {
      const url = address.includes(".") ? `https://${address}/jobs/1` : address;

      expect(parserForUrl(url)?.name ?? null).toBe(parser);
    }
  );
});

describe("AC 8: no parser opens a browser", () => {
  test("no parser's source reaches for Playwright", () => {
    for (const domain of DOMAINS) {
      const source = readFileSync(
        `lib/parsers/${PARSERS_BY_DOMAIN[domain].name}.ts`,
        "utf8"
      );

      expect(source).not.toContain("playwright");
    }
  });
});
