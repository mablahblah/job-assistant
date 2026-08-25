import { describe, it, expect, vi } from "vitest";

// Prevent transitive Prisma import (company-cache) from failing in test env
vi.mock("@/lib/prisma", () => ({
  prisma: {
    company: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

import { mapLeverFields, extractLeverSlugAndId } from "./lever";

describe("extractLeverSlugAndId", () => {
  it("extracts from standard Lever URL", () => {
    const result = extractLeverSlugAndId("https://jobs.lever.co/plaid/abc-123-def");
    expect(result).toEqual({ slug: "plaid", postingId: "abc-123-def" });
  });

  it("handles URL with trailing slash", () => {
    const result = extractLeverSlugAndId("https://jobs.lever.co/plaid/abc-123/");
    expect(result).toEqual({ slug: "plaid", postingId: "abc-123" });
  });

  it("returns null for non-Lever URL", () => {
    expect(extractLeverSlugAndId("https://boards.greenhouse.io/stripe/jobs/123")).toBeNull();
  });
});

describe("mapLeverFields", () => {
  it("maps all fields from a complete posting", () => {
    const posting = {
      id: "abc-123",
      text: "Senior Product Designer",
      categories: { location: "San Francisco, CA", team: "Design" },
      createdAt: 1713182400000, // 2024-04-15T12:00:00Z
      workplaceType: "remote",
      descriptionPlain: "We offer $150,000 - $200,000 annually",
    };
    const result = mapLeverFields(posting);
    expect(result.title).toBe("Senior Product Designer");
    expect(result.location).toBe("San Francisco, CA");
    expect(result.workMode).toBe("remote");
    expect(result.salaryRange).toBe("$150-200k");
  });

  it("uses workplaceType for work mode when available", () => {
    expect(mapLeverFields({
      id: "1", text: "D", categories: {}, createdAt: 0,
      workplaceType: "hybrid",
    }).workMode).toBe("hybrid");

    expect(mapLeverFields({
      id: "1", text: "D", categories: {}, createdAt: 0,
      workplaceType: "on-site",
    }).workMode).toBe("in-person");
  });

  it("falls back to text detection when no workplaceType", () => {
    const posting = {
      id: "1", text: "Designer", categories: {}, createdAt: 0,
      descriptionPlain: "This is a remote-friendly role",
    };
    expect(mapLeverFields(posting).workMode).toBe("remote");
  });

  it("converts createdAt epoch ms to date string", () => {
    // 2026-04-22 00:00:00 UTC = 1776816000000
    const posting = {
      id: "1", text: "D", categories: {}, createdAt: 1776816000000,
    };
    expect(mapLeverFields(posting).dates).toContain("2026-04-22");
  });

  it("returns '?' salary when no match in description", () => {
    const posting = {
      id: "1", text: "D", categories: {}, createdAt: 0,
      descriptionPlain: "Great opportunity to grow",
    };
    expect(mapLeverFields(posting).salaryRange).toBe("?");
  });
});
