import { describe, it, expect, beforeEach } from "vitest";
import {
  matchDomain,
  isGreenlitDomain,
  registerParser,
  getParser,
  routeByDomain,
  clearRegistry,
} from "./registry";
import type { Browser } from "playwright";
import type { CollectedJob } from "../collectors/types";
import type { PipelineJob, ParserResult } from "./types";

// Stub parser matching the ParserFn signature
const stubParser = async (_url: string, _browser: Browser, _collectorData?: CollectedJob): Promise<ParserResult> => ({
  success: true,
  url: "",
  finalUrl: "",
  parser: "stub",
  fields: {},
  failedFields: [],
});

const stubParser2 = async (_url: string, _browser: Browser, _collectorData?: CollectedJob): Promise<ParserResult> => ({
  success: true,
  url: "",
  finalUrl: "",
  parser: "stub2",
  fields: {},
  failedFields: [],
});

describe("matchDomain", () => {
  beforeEach(() => {
    clearRegistry();
    registerParser("jobs.ashbyhq.com", stubParser);
    registerParser("boards.greenhouse.io", stubParser);
    registerParser("jobs.lever.co", stubParser);
    registerParser("adzuna.com", stubParser);
    registerParser("dribbble.com", stubParser);
  });

  it("returns registry key for exact domain match", () => {
    expect(matchDomain("jobs.ashbyhq.com")).toBe("jobs.ashbyhq.com");
  });

  it("returns null for unregistered domain", () => {
    expect(matchDomain("example.com")).toBeNull();
  });

  it("returns registry key for subdomain of registered domain", () => {
    // www.adzuna.com is a subdomain of registered adzuna.com
    expect(matchDomain("www.adzuna.com")).toBe("adzuna.com");
  });

  it("returns registry key for standard Greenhouse domain", () => {
    expect(matchDomain("boards.greenhouse.io")).toBe("boards.greenhouse.io");
  });

  it("returns boards.greenhouse.io for job-boards.greenhouse.io", () => {
    // The bug fix — job-boards.greenhouse.io should match the Greenhouse parser
    expect(matchDomain("job-boards.greenhouse.io")).toBe("boards.greenhouse.io");
  });

  it("returns boards.greenhouse.io for custom Greenhouse subdomain (.io)", () => {
    expect(matchDomain("acme.greenhouse.io")).toBe("boards.greenhouse.io");
  });

  it("returns boards.greenhouse.io for custom Greenhouse subdomain (.com)", () => {
    expect(matchDomain("acme.greenhouse.com")).toBe("boards.greenhouse.io");
  });

  it("returns null when Greenhouse parser is not registered", () => {
    clearRegistry();
    // No parsers registered — Greenhouse wildcard should not match
    expect(matchDomain("boards.greenhouse.io")).toBeNull();
  });

  it("returns null for invalid input", () => {
    expect(matchDomain("")).toBeNull();
  });
});

describe("isGreenlitDomain", () => {
  beforeEach(() => {
    clearRegistry();
    registerParser("jobs.ashbyhq.com", stubParser);
    registerParser("boards.greenhouse.io", stubParser);
    registerParser("jobs.lever.co", stubParser);
    registerParser("adzuna.com", stubParser);
    registerParser("dribbble.com", stubParser);
  });

  it("returns registry key for a greenlit URL", () => {
    expect(
      isGreenlitDomain("https://jobs.ashbyhq.com/notion/abc123"),
    ).toBe("jobs.ashbyhq.com");
  });

  it("returns null for a non-greenlit URL", () => {
    expect(isGreenlitDomain("https://example.com/jobs/123")).toBeNull();
  });

  it("returns registry key for Adzuna subdomain URL", () => {
    // www.adzuna.com matches registered adzuna.com — returns the registry key
    expect(
      isGreenlitDomain("https://www.adzuna.com/details/12345"),
    ).toBe("adzuna.com");
  });

  it("returns registry key for bare adzuna.com URL", () => {
    expect(
      isGreenlitDomain("https://adzuna.com/details/12345"),
    ).toBe("adzuna.com");
  });

  it("returns null for an invalid URL", () => {
    expect(isGreenlitDomain("not-a-url")).toBeNull();
  });

  it("returns boards.greenhouse.io for standard Greenhouse URL", () => {
    expect(
      isGreenlitDomain("https://boards.greenhouse.io/stripe/jobs/12345"),
    ).toBe("boards.greenhouse.io");
  });

  it("returns boards.greenhouse.io for custom Greenhouse subdomain (.io)", () => {
    expect(
      isGreenlitDomain("https://acme.greenhouse.io/jobs/12345"),
    ).toBe("boards.greenhouse.io");
  });

  it("returns boards.greenhouse.io for custom Greenhouse subdomain (.com)", () => {
    expect(
      isGreenlitDomain("https://acme.greenhouse.com/jobs/12345"),
    ).toBe("boards.greenhouse.io");
  });

  it("returns registry key for Lever URL", () => {
    expect(
      isGreenlitDomain("https://jobs.lever.co/plaid/abc123"),
    ).toBe("jobs.lever.co");
  });
});

describe("registerParser / getParser", () => {
  beforeEach(() => clearRegistry());

  it("registers and retrieves a parser", () => {
    registerParser("jobs.ashbyhq.com", stubParser);
    expect(getParser("jobs.ashbyhq.com")).toBe(stubParser);
  });

  it("returns null for unregistered domain", () => {
    expect(getParser("unknown.com")).toBeNull();
  });
});

describe("routeByDomain", () => {
  beforeEach(() => {
    clearRegistry();
    registerParser("jobs.ashbyhq.com", stubParser);
    registerParser("boards.greenhouse.io", stubParser2);
  });

  it("routes jobs with registered parsers to matched bucket", () => {
    const jobs: PipelineJob[] = [
      {
        id: "1",
        url: "https://adzuna.com/1",
        title: "Designer",
        companyName: "Acme",
        finalUrl: "https://jobs.ashbyhq.com/acme/1",
        finalDomain: "jobs.ashbyhq.com",
        source: "resolved",
      },
    ];
    const { matched, unmatched } = routeByDomain(jobs);
    expect(matched["jobs.ashbyhq.com"]).toHaveLength(1);
    expect(unmatched).toHaveLength(0);
  });

  it("routes jobs without parsers to unmatched bucket", () => {
    const jobs: PipelineJob[] = [
      {
        id: "2",
        url: "https://adzuna.com/2",
        title: "Designer",
        companyName: "Beta",
        finalUrl: "https://unknown.com/beta/2",
        finalDomain: "unknown.com",
        source: "resolved",
      },
    ];
    const { matched, unmatched } = routeByDomain(jobs);
    expect(unmatched).toHaveLength(1);
    expect(Object.keys(matched)).toHaveLength(0);
  });

  it("groups multiple jobs for the same parser", () => {
    const jobs: PipelineJob[] = [
      {
        id: "3",
        url: "https://x.com/3",
        title: "D3",
        companyName: "C",
        finalUrl: "https://jobs.ashbyhq.com/c/3",
        finalDomain: "jobs.ashbyhq.com",
        source: "resolved",
      },
      {
        id: "4",
        url: "https://x.com/4",
        title: "D4",
        companyName: "D",
        finalUrl: "https://jobs.ashbyhq.com/d/4",
        finalDomain: "jobs.ashbyhq.com",
        source: "resolved",
      },
    ];
    const { matched } = routeByDomain(jobs);
    expect(matched["jobs.ashbyhq.com"]).toHaveLength(2);
  });

  it("routes job-boards.greenhouse.io to boards.greenhouse.io parser (bug fix)", () => {
    const jobs: PipelineJob[] = [
      {
        id: "5",
        url: "https://weloveproduct.co/job/5",
        title: "Designer",
        companyName: "Intercom",
        finalUrl: "https://job-boards.greenhouse.io/intercom/jobs/123",
        finalDomain: "job-boards.greenhouse.io",
        source: "resolved",
      },
    ];
    const { matched, unmatched } = routeByDomain(jobs);
    expect(matched["boards.greenhouse.io"]).toHaveLength(1);
    expect(unmatched).toHaveLength(0);
  });

  it("routes custom Greenhouse subdomains to boards.greenhouse.io parser", () => {
    const jobs: PipelineJob[] = [
      {
        id: "6",
        url: "https://weloveproduct.co/job/6",
        title: "Designer",
        companyName: "Acme",
        finalUrl: "https://acme.greenhouse.io/jobs/456",
        finalDomain: "acme.greenhouse.io",
        source: "resolved",
      },
    ];
    const { matched, unmatched } = routeByDomain(jobs);
    expect(matched["boards.greenhouse.io"]).toHaveLength(1);
    expect(unmatched).toHaveLength(0);
  });

  it("routes subdomain variants to registered parent domain", () => {
    clearRegistry();
    registerParser("adzuna.com", stubParser);
    const jobs: PipelineJob[] = [
      {
        id: "7",
        url: "https://jsearch.com/7",
        title: "Designer",
        companyName: "Co",
        finalUrl: "https://www.adzuna.com/details/7",
        finalDomain: "www.adzuna.com",
        source: "resolved",
      },
    ];
    const { matched } = routeByDomain(jobs);
    expect(matched["adzuna.com"]).toHaveLength(1);
  });
});
