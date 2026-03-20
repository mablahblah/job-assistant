import { describe, it, expect } from "vitest";
import { parseSalaryRange, salaryModifier, calculateScore } from "./scoring";

describe("parseSalaryRange", () => {
  it('returns empty for unknown "?"', () => {
    expect(parseSalaryRange("?")).toEqual({});
  });

  it("returns empty for empty string", () => {
    expect(parseSalaryRange("")).toEqual({});
  });

  it("parses $150-188k range", () => {
    expect(parseSalaryRange("$150-188k")).toEqual({
      min: 150_000,
      max: 188_000,
    });
  });

  it("parses $120k+ (min only)", () => {
    expect(parseSalaryRange("$120k+")).toEqual({ min: 120_000 });
  });

  it("parses up to $200k (max only)", () => {
    expect(parseSalaryRange("up to $200k")).toEqual({ max: 200_000 });
  });

  it("annualizes $75/hour to yearly", () => {
    // 75 * 2080 = 156,000
    expect(parseSalaryRange("$75/hour")).toEqual({ min: 156_000 });
  });

  it("annualizes hourly range $50/hour-$75/hour", () => {
    expect(parseSalaryRange("$50/hour-$75/hour")).toEqual({
      min: 104_000,
      max: 156_000,
    });
  });

  it("annualizes monthly salary $10000/month", () => {
    expect(parseSalaryRange("$10000/month")).toEqual({ min: 120_000 });
  });

  it("returns empty for unknown period like /week", () => {
    expect(parseSalaryRange("$1000/week")).toEqual({});
  });
});

describe("salaryModifier", () => {
  // target is $150k

  it("returns 1.0 for unknown salary", () => {
    expect(salaryModifier("?")).toBe(1);
  });

  it("returns 1.0 when target is within range", () => {
    expect(salaryModifier("$125-160k")).toBe(1);
  });

  it("returns 0.9 when range max is ~$30k below target", () => {
    // max $120k, gap = $30k, floor(30k/25k) = 1, modifier = 1 - 0.1 = 0.9
    expect(salaryModifier("$100-120k")).toBeCloseTo(0.9);
  });

  it("returns 0.8 when range max is ~$50k below target", () => {
    // max $100k, gap = $50k, floor(50k/25k) = 2, modifier = 1 - 0.2 = 0.8
    expect(salaryModifier("$80-100k")).toBeCloseTo(0.8);
  });

  it("returns 1.2 when range min is $50k above target", () => {
    // min $200k, gap = $50k, floor(50k/25k) = 2, modifier = 1 + 0.2 = 1.2
    expect(salaryModifier("$200-300k")).toBeCloseTo(1.2);
  });

  it("returns 1.0 for min-only where min <= target", () => {
    // $120k+ means min=120k, no max — target could be in range
    expect(salaryModifier("$120k+")).toBe(1);
  });

  it("returns boost for min-only above target", () => {
    // $200k+ means min=200k, gap = $50k
    expect(salaryModifier("$200k+")).toBeCloseTo(1.2);
  });

  it("returns 1.0 for max-only where max >= target", () => {
    // "up to $200k" — target within implied range
    expect(salaryModifier("up to $200k")).toBe(1);
  });

  it("returns penalty for max-only below target", () => {
    // "up to $100k", gap = $50k
    expect(salaryModifier("up to $100k")).toBeCloseTo(0.8);
  });

  it("handles hourly rate annualization in modifier", () => {
    // $75/hour = $156k annual, target is $150k, within range → 1.0
    // (min-only, min $156k > $150k target, gap = $6k, floor(6k/25k) = 0 → 1.0)
    expect(salaryModifier("$75/hour")).toBeCloseTo(1.0);
  });
});

describe("calculateScore with salary modifier", () => {
  const company = {
    id: "1",
    name: "Test Co",
    employeeSatisfaction: 5,
    customerSatisfaction: 5,
    workLifeBalance: 5,
    politicalAlignment: 5,
    benefits: 5,
  };

  const baseJob = {
    id: "1",
    companyId: "1",
    title: "Designer",
    url: "https://example.com",
    location: "Remote",
    workMode: "remote",
    postedAt: new Date().toISOString(), // fresh post, age modifier = 1.0
    salaryRange: "?",
    status: "new",
  };

  it("salary modifier does not affect score when salary unknown", () => {
    const score = calculateScore(baseJob, company);
    const withSalary = calculateScore({ ...baseJob, salaryRange: "$125-175k" }, company);
    expect(score).toBe(withSalary); // both should be neutral
  });

  it("low salary reduces score", () => {
    const neutral = calculateScore(baseJob, company);
    const low = calculateScore({ ...baseJob, salaryRange: "$50-80k" }, company);
    expect(low).toBeLessThan(neutral);
  });

  it("high salary boosts score", () => {
    // all-5s company hits the 100 cap, so use 3s across the board to leave room for the boost
    const lowerCompany = { ...company, employeeSatisfaction: 3 as number | null, customerSatisfaction: 3 as number | null, workLifeBalance: 3 as number | null, politicalAlignment: 3 as number | null, benefits: 3 as number | null };
    const neutral = calculateScore(baseJob, lowerCompany);
    const high = calculateScore({ ...baseJob, salaryRange: "$200-250k" }, lowerCompany);
    expect(high).toBeGreaterThan(neutral);
  });
});
