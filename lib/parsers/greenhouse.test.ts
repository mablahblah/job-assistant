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

import { mapGreenhouseFields, extractGreenhouseSlugAndId } from "./greenhouse";

describe("extractGreenhouseSlugAndId", () => {
  it("extracts from standard boards URL", () => {
    const result = extractGreenhouseSlugAndId("https://boards.greenhouse.io/stripe/jobs/12345");
    expect(result).toEqual({ slug: "stripe", jobId: "12345" });
  });

  it("extracts from custom subdomain URL (.io)", () => {
    const result = extractGreenhouseSlugAndId("https://gitlab.greenhouse.io/jobs/67890");
    expect(result).toEqual({ slug: "gitlab", jobId: "67890" });
  });

  it("extracts from custom subdomain URL (.com)", () => {
    const result = extractGreenhouseSlugAndId("https://acme.greenhouse.com/jobs/99999");
    expect(result).toEqual({ slug: "acme", jobId: "99999" });
  });

  it("returns null for non-Greenhouse URL", () => {
    expect(extractGreenhouseSlugAndId("https://jobs.lever.co/plaid/123")).toBeNull();
  });
});

describe("mapGreenhouseFields", () => {
  it("maps all fields from a complete API response", () => {
    const job = {
      id: 12345,
      title: "Senior Product Designer",
      location: { name: "San Francisco, CA" },
      updated_at: "2026-04-15T10:00:00Z",
      content: "<p>We are looking for a remote designer...</p>",
      pay_input_ranges: [
        { min_cents: 15000000, max_cents: 20000000, currency_type: "USD", title: "Salary" },
      ],
    };
    const result = mapGreenhouseFields(job);
    expect(result.title).toBe("Senior Product Designer");
    expect(result.location).toBe("San Francisco, CA");
    expect(result.dates).toContain("2026-04-15");
    expect(result.salaryRange).toBe("$150-200k");
    expect(result.workMode).toBe("remote");
  });

  it("falls back to parseSalaryFromText when no pay_input_ranges", () => {
    const job = {
      id: 1,
      title: "Designer",
      location: { name: "Remote" },
      updated_at: "2026-04-15T10:00:00Z",
      content: "<p>Salary: $120,000 - $160,000</p>",
    };
    const result = mapGreenhouseFields(job);
    expect(result.salaryRange).toBe("$120-160k");
  });

  it("returns '?' salary when no pay data and no text match", () => {
    const job = {
      id: 1,
      title: "Designer",
      location: { name: "NYC" },
      updated_at: "2026-04-15T10:00:00Z",
      content: "<p>Great opportunity</p>",
    };
    const result = mapGreenhouseFields(job);
    expect(result.salaryRange).toBe("?");
  });

  it("includes both first_published and updated_at when present", () => {
    const job = {
      id: 1,
      title: "Designer",
      location: { name: "Remote" },
      first_published: "2024-11-01T00:00:00Z",
      updated_at: "2026-04-16T10:00:00Z",
      content: "",
    };
    const result = mapGreenhouseFields(job);
    expect(result.dates).toContain("2024-11-01");
    expect(result.dates).toContain("2026-04-16");
    expect(result.dates).toHaveLength(2);
  });

  it("extracts date portion only from updated_at", () => {
    const job = {
      id: 1,
      title: "Designer",
      location: { name: "Austin" },
      updated_at: "2026-04-22T18:30:00Z",
      content: "",
    };
    const result = mapGreenhouseFields(job);
    expect(result.dates).toContain("2026-04-22");
  });

  it("detects hybrid work mode from content", () => {
    const job = {
      id: 1,
      title: "Designer",
      location: { name: "Austin, TX" },
      updated_at: "2026-04-15T10:00:00Z",
      content: "<p>This is a hybrid position</p>",
    };
    const result = mapGreenhouseFields(job);
    expect(result.workMode).toBe("hybrid");
  });

  it("returns empty workMode when no signals", () => {
    const job = {
      id: 1,
      title: "Designer",
      location: { name: "Austin" },
      updated_at: "2026-04-15T10:00:00Z",
      content: "<p>Join our team</p>",
    };
    const result = mapGreenhouseFields(job);
    expect(result.workMode).toBe("");
  });
});
