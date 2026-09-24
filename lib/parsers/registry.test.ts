import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
    ["https://meredith.wd5.myworkdayjobs.com/en-US/EXT/job/New-York-NY/Designer_JR1", "workday"],
    [
      "https://recruiting.ultipro.com/tel1010tefo/jobboard/914e6c7a/opportunitydetail?opportunityid=e3a376f8",
      "ultipro",
    ],
    ["https://jobs.gem.com/fetch/7536752003?utm_source=adzuna", "gem"],
    ["https://jobs.smartrecruiters.com/RodeoFX/744000148584589-ux-specialist", "smartrecruiters"],
    ["https://shortcut.bamboohr.com/careers/40?utm_source=adzuna", "bamboohr"],
    ["https://ats.rippling.com/radicl-defense/jobs/371ee603-a211-467c-b868-b5f5b68ccbff", "rippling"],
    ["https://apply.workable.com/blueground/j/08717EF2F6/", "workable"],
  ])("%s reaches the %s parser", (url, name) => {
    expect(parserForUrl(url)?.name).toBe(name);
  });
});

describe("AC 3: a domain the registry does not name reaches no parser", () => {
  test.each([
    "https://www.indeed.com/viewjob?jk=1",
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

// AC 1 and 16. The owned-domain list is tried first, and only a link it
// cannot place is offered to each parser to recognise. Measured 2026-09-20:
// six employers host their Greenhouse postings on their own website, and no
// registry entry owns any of those websites.
describe("a link no domain entry owns is offered to each parser", () => {
  test.each([
    "https://www.brex.com/careers/8777949002?gh_jid=8777949002",
    "https://www.moduscreate.com/careers/7994649003?gh_jid=7994649003",
    "https://www.datavant.com/about/careers/open-roles/job?gh_jid=5365997008",
    "https://www.gladly.ai/careers/?utm_source=greenhouse-recruiting&gh_jid=8208190",
    "https://ats.comparably.com/api/v2/stash/post/8209111:?gh_jid=8209111",
    "https://www.pinterestcareers.com/jobs/7684577/senior-product-designer/?gh_jid=7684577",
  ])("%s reaches the parser that claims it", (url) => {
    expect(parserForUrl(url)?.name).toBe("greenhouse");
  });

  // AC 3. Most links no entry owns have nothing to do with any parser here.
  test.each([
    "https://www.indeed.com/viewjob?jk=1",
    "https://www.adzuna.com/details/1",
    "https://www.brex.com/careers/8777949002",
  ])("%s is claimed by no parser and still reaches none", (url) => {
    expect(parserForUrl(url)).toBeNull();
  });
});

// AC 16. A link whose website an entry owns never reaches the claiming step,
// so a parser can never take a link another parser already owns. Measured
// 2026-09-20: all 309 postings already on a Greenhouse address also carry a
// Greenhouse job number, so the order is what keeps them on their own reader.
describe("the owned-domain list is tried before any parser is asked", () => {
  test.each([
    ["https://jobs.lever.co/acme/1?gh_jid=12345", "lever"],
    ["https://jobs.ashbyhq.com/acme/1?gh_jid=12345", "ashby"],
    ["https://dribbble.com/jobs/1?gh_jid=12345", "dribbble"],
  ])("%s still reaches the %s parser, not the one claiming its job number", (url, name) => {
    expect(parserForUrl(url)?.name).toBe(name);
  });
});

// Every module a file loads when it runs, followed through the app's own
// files to the packages at the end. Type-only imports load nothing, so they
// are left out.
function modulesLoadedBy(file: string, seen = new Set<string>()): Set<string> {
  if (seen.has(file)) return seen;
  seen.add(file);
  const source = readFileSync(file, "utf8");
  const runtimeImport = /^import\s+(?!type\s)[^;]*?from\s+["']([^"']+)["']/gm;
  for (const [, specifier] of source.matchAll(runtimeImport)) {
    if (specifier.startsWith(".")) {
      modulesLoadedBy(`${resolve(dirname(file), specifier)}.ts`, seen);
    } else {
      seen.add(specifier);
    }
  }
  return seen;
}

describe("AC 8: no parser opens a browser", () => {
  test.each(DOMAINS)("the %s parser loads no browser, directly or through another file", (domain) => {
    const loaded = modulesLoadedBy(resolve(`lib/parsers/${PARSERS_BY_DOMAIN[domain].name}.ts`));

    expect([...loaded].filter((module) => module === "playwright")).toEqual([]);
  });
});
