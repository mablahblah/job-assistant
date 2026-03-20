import { describe, it, expect } from "vitest";
import {
  formatSalary,
  detectWorkModeFromText,
  detectWorkModeFromData,
  matchesQuery,
  decodeHtmlEntities,
  parseSalaryFromText,
} from "./fetch-utils";

// --- formatSalary ---

describe("formatSalary", () => {
  it("returns '?' when no salary data", () => {
    expect(formatSalary()).toBe("?");
    expect(formatSalary(undefined, undefined)).toBe("?");
  });

  it("formats min-max range as abbreviated k", () => {
    expect(formatSalary(150000, 200000)).toBe("$150-200k");
  });

  it("formats min-only as k+", () => {
    expect(formatSalary(120000)).toBe("$120k+");
  });

  it("formats max-only as 'up to'", () => {
    expect(formatSalary(undefined, 180000)).toBe("up to $180k");
  });

  it("rounds to nearest thousand", () => {
    expect(formatSalary(149500, 200400)).toBe("$150-200k");
  });

  it("handles non-annual period (hourly)", () => {
    expect(formatSalary(50, 75, "HOUR")).toBe("$50/hour-$75/hour");
  });

  it("handles non-annual min-only", () => {
    expect(formatSalary(50, undefined, "HOUR")).toBe("$50/hour+");
  });

  it("handles non-annual max-only", () => {
    expect(formatSalary(undefined, 75, "HOUR")).toBe("up to $75/hour");
  });

  it("treats YEAR same as no period (annual)", () => {
    expect(formatSalary(150000, 200000, "YEAR")).toBe("$150-200k");
  });
});

// --- detectWorkModeFromText ---

describe("detectWorkModeFromText", () => {
  it("returns empty string by default when no match", () => {
    expect(detectWorkModeFromText("some random text")).toBe("");
  });

  it("returns custom default when no match", () => {
    expect(detectWorkModeFromText("some random text", "in-person")).toBe("in-person");
  });

  it("detects 'remote'", () => {
    expect(detectWorkModeFromText("This is a Remote position")).toBe("remote");
  });

  it("detects 'hybrid'", () => {
    expect(detectWorkModeFromText("Hybrid work environment")).toBe("hybrid");
  });

  it("detects 'in-person'", () => {
    expect(detectWorkModeFromText("This is an in-person role")).toBe("in-person");
  });

  it("detects 'on-site'", () => {
    expect(detectWorkModeFromText("On-site in San Francisco")).toBe("in-person");
  });

  it("detects 'onsite'", () => {
    expect(detectWorkModeFromText("Onsite only")).toBe("in-person");
  });

  it("detects 'in office'", () => {
    expect(detectWorkModeFromText("Must work in office")).toBe("in-person");
  });

  it("is case insensitive", () => {
    expect(detectWorkModeFromText("REMOTE WORK")).toBe("remote");
    expect(detectWorkModeFromText("HYBRID")).toBe("hybrid");
    expect(detectWorkModeFromText("ON-SITE")).toBe("in-person");
  });

  it("prioritizes in-person over hybrid over remote", () => {
    // if text mentions both in-person and remote, in-person wins
    expect(detectWorkModeFromText("in-person with some remote days")).toBe("in-person");
    // if text mentions both hybrid and remote, hybrid wins
    expect(detectWorkModeFromText("hybrid or remote")).toBe("hybrid");
  });
});

// --- detectWorkModeFromData ---

describe("detectWorkModeFromData", () => {
  it("returns empty string when no fields provided", () => {
    expect(detectWorkModeFromData({})).toBe("");
  });

  // boolean isRemote (JSearch pattern)
  it("returns 'remote' for isRemote: true", () => {
    expect(detectWorkModeFromData({ isRemote: true })).toBe("remote");
  });

  it("returns '' for isRemote: false", () => {
    expect(detectWorkModeFromData({ isRemote: false })).toBe("");
  });

  // enum workplaceType (Lever pattern)
  it("maps workplaceType 'remote'", () => {
    expect(detectWorkModeFromData({ workplaceType: "remote" })).toBe("remote");
  });

  it("maps workplaceType 'hybrid'", () => {
    expect(detectWorkModeFromData({ workplaceType: "hybrid" })).toBe("hybrid");
  });

  it("maps workplaceType 'on-site' to 'in-person'", () => {
    expect(detectWorkModeFromData({ workplaceType: "on-site" })).toBe("in-person");
  });

  it("maps workplaceType 'onsite' to 'in-person'", () => {
    expect(detectWorkModeFromData({ workplaceType: "onsite" })).toBe("in-person");
  });

  it("is case insensitive for workplaceType", () => {
    expect(detectWorkModeFromData({ workplaceType: "Remote" })).toBe("remote");
    expect(detectWorkModeFromData({ workplaceType: "HYBRID" })).toBe("hybrid");
  });

  // JSON-LD fields (WeLoveProduct pattern)
  it("detects remote from jobLocationType", () => {
    expect(detectWorkModeFromData({ jobLocationType: "TELECOMMUTE" })).toBe("");
    expect(detectWorkModeFromData({ jobLocationType: "remote" })).toBe("remote");
  });

  it("detects remote from jobBenefits", () => {
    expect(detectWorkModeFromData({ jobBenefits: "Remote work, health insurance" })).toBe("remote");
  });

  it("detects hybrid from jobLocationType", () => {
    expect(detectWorkModeFromData({ jobLocationType: "hybrid" })).toBe("hybrid");
  });

  it("detects hybrid from jobBenefits", () => {
    expect(detectWorkModeFromData({ jobBenefits: "Hybrid schedule available" })).toBe("hybrid");
  });
});

// --- decodeHtmlEntities ---

describe("decodeHtmlEntities", () => {
  it("decodes basic entities", () => {
    expect(decodeHtmlEntities("&amp; &lt; &gt; &quot;")).toBe('& < > "');
  });

  it("decodes mdash and ndash", () => {
    expect(decodeHtmlEntities("$100k &mdash; $150k")).toBe("$100k — $150k");
    expect(decodeHtmlEntities("$100k &ndash; $150k")).toBe("$100k – $150k");
  });

  it("handles double-encoded entities", () => {
    expect(decodeHtmlEntities("&amp;mdash;")).toBe("—");
  });

  it("returns plain text unchanged", () => {
    expect(decodeHtmlEntities("hello world")).toBe("hello world");
  });
});

// --- parseSalaryFromText ---

describe("parseSalaryFromText", () => {
  it("returns '?' when no salary found", () => {
    expect(parseSalaryFromText("No salary info here")).toBe("?");
  });

  it("extracts $X - $Y range", () => {
    expect(parseSalaryFromText("Salary: $81,300 - $91,300")).toBe("$81-91k");
  });

  it("extracts $X — $Y with mdash", () => {
    expect(parseSalaryFromText("$150,000 — $200,000 per year")).toBe("$150-200k");
  });

  it("extracts $X–$Y with ndash", () => {
    expect(parseSalaryFromText("$120,000–$180,000")).toBe("$120-180k");
  });

  it("handles range without second dollar sign", () => {
    expect(parseSalaryFromText("$150,000 - 200,000")).toBe("$150-200k");
  });

  it("strips HTML tags before parsing", () => {
    expect(parseSalaryFromText("<p>Salary: $150,000 - $200,000</p>")).toBe("$150-200k");
  });

  it("handles double-encoded HTML entities", () => {
    expect(parseSalaryFromText("$150,000 &amp;mdash; $200,000")).toBe("$150-200k");
  });

  it("rounds to nearest thousand", () => {
    expect(parseSalaryFromText("$149,500 - $200,400")).toBe("$150-200k");
  });
});

// --- matchesQuery ---

describe("matchesQuery", () => {
  it("returns true for substring match", () => {
    expect(matchesQuery("Senior Product Designer", ["product designer"])).toBe(true);
  });

  it("returns true if any query matches", () => {
    expect(matchesQuery("UX Designer", ["product designer", "ux designer"])).toBe(true);
  });

  it("returns false when no query matches", () => {
    expect(matchesQuery("Software Engineer", ["product designer"])).toBe(false);
  });

  it("is case insensitive", () => {
    expect(matchesQuery("PRODUCT DESIGNER", ["product designer"])).toBe(true);
    expect(matchesQuery("product designer", ["PRODUCT DESIGNER"])).toBe(true);
  });

  it("returns false for empty queries", () => {
    expect(matchesQuery("Product Designer", [])).toBe(false);
  });

  it("matches partial words", () => {
    expect(matchesQuery("Product Designer III", ["design"])).toBe(true);
  });
});
