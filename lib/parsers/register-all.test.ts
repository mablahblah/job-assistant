import { describe, it, expect, beforeEach, vi } from "vitest";

// Prevent the transitive Prisma import (greenhouse/lever → company-cache) from
// failing in the test env.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    company: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

import { registerAllParsers } from "./register-all";
import { clearRegistry, getParser } from "./registry";
import { parseAshbyJob } from "./ashby";
import { parseGreenhouseJob } from "./greenhouse";
import { parseLeverJob } from "./lever";
import { parseAdzunaJob } from "./adzuna";
import { parseDribbbleJob } from "./dribbble";

// Every domain the pipeline handles, paired with the parser that owns it.
const EXPECTED: Array<[string, unknown]> = [
  ["jobs.ashbyhq.com", parseAshbyJob],
  ["boards.greenhouse.io", parseGreenhouseJob],
  ["jobs.lever.co", parseLeverJob],
  ["adzuna.com", parseAdzunaJob],
  ["dribbble.com", parseDribbbleJob],
];

describe("registerAllParsers", () => {
  beforeEach(() => {
    clearRegistry();
    registerAllParsers();
  });

  for (const [domain, parser] of EXPECTED) {
    it(`registers ${domain}`, () => {
      expect(getParser(domain)).toBe(parser);
    });
  }

  it("registers no parser for an unhandled domain", () => {
    expect(getParser("jobs.workday.com")).toBeNull();
  });
});
