import { describe, it, expect } from "vitest";
import { matchCategories } from "./match-categories";

// The full category list from UIUXJobsBoard
const CATEGORIES = [
  { value: "ui-designer", label: "UI Design" },
  { value: "ux-designer", label: "UX Design" },
  { value: "ui-ux-designer", label: "UI/UX Design" },
  { value: "product-designer", label: "Product Design" },
  { value: "ux-researcher", label: "UX Research" },
  { value: "ux-writer", label: "UX Writing" },
];

describe("matchCategories", () => {
  it("matches single-word term against multiple categories", () => {
    const result = matchCategories(["ux"], CATEGORIES);
    expect(result.map((c) => c.value)).toEqual([
      "ux-designer",
      "ui-ux-designer",
      "ux-researcher",
      "ux-writer",
    ]);
  });

  it("matches multi-word term requiring all words present", () => {
    const result = matchCategories(["product design"], CATEGORIES);
    expect(result.map((c) => c.value)).toEqual(["product-designer"]);
  });

  it("is case-insensitive", () => {
    const result = matchCategories(["Product Design"], CATEGORIES);
    expect(result.map((c) => c.value)).toEqual(["product-designer"]);
  });

  it("returns empty array for empty search terms", () => {
    const result = matchCategories([], CATEGORIES);
    expect(result).toEqual([]);
  });

  it("deduplicates across multiple search terms", () => {
    const result = matchCategories(["ux", "product design"], CATEGORIES);
    const values = result.map((c) => c.value);
    expect(values).toContain("product-designer");
    expect(values).toContain("ux-designer");
    expect(new Set(values).size).toBe(values.length);
  });

  it("returns empty array when nothing matches", () => {
    const result = matchCategories(["product manager"], CATEGORIES);
    expect(result).toEqual([]);
  });
});
