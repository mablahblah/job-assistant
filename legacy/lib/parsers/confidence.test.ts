import { describe, it, expect } from "vitest";
import { compareFields } from "./confidence";

describe("compareFields", () => {
  it("returns high confidence when parser and collector values match", () => {
    const parsed = { title: "Product Designer", companyName: "Acme" };
    const collected = { title: "Product Designer", companyName: "Acme" };
    const results = compareFields(parsed, collected);

    expect(results).toContainEqual({
      field: "title",
      confidence: "high",
      value: "Product Designer",
      parserValue: "Product Designer",
      collectorValue: "Product Designer",
    });
  });

  it("returns low confidence when parser and collector disagree — parser wins", () => {
    const parsed = { workMode: "hybrid" };
    const collected = { workMode: "remote" };
    const results = compareFields(parsed, collected);

    const workMode = results.find((r) => r.field === "workMode");
    expect(workMode).toMatchObject({
      confidence: "low",
      value: "hybrid",
      parserValue: "hybrid",
      collectorValue: "remote",
    });
  });

  it("returns medium confidence when only parser has the field", () => {
    const parsed = { salaryRange: "$150-188k" };
    const results = compareFields(parsed, null);

    expect(results).toContainEqual({
      field: "salaryRange",
      confidence: "medium",
      value: "$150-188k",
      parserValue: "$150-188k",
    });
  });

  it("returns medium confidence when only collector has the field", () => {
    const parsed = {};
    const collected = { location: "San Francisco, CA" };
    const results = compareFields(parsed, collected);

    expect(results).toContainEqual({
      field: "location",
      confidence: "medium",
      value: "San Francisco, CA",
      collectorValue: "San Francisco, CA",
    });
  });

  it("skips fields neither source provided", () => {
    const parsed = { title: "Designer" };
    const collected = { title: "Designer" };
    const results = compareFields(parsed, collected);

    expect(results).toHaveLength(1);
    expect(results[0].field).toBe("title");
  });

  it("normalizes whitespace and case for comparison", () => {
    const parsed = { title: "Senior  Product Designer" };
    const collected = { title: "senior product designer" };
    const results = compareFields(parsed, collected);

    expect(results[0].confidence).toBe("high");
  });
});
