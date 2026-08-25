import { describe, it, expect } from "vitest";
import { getParserPriority, dedupeByUrl, dedupeByContent, type ContentDedupeItem } from "./dedupe";

describe("getParserPriority", () => {
  it("returns priority 1 for greenhouse", () => {
    expect(getParserPriority("greenhouse")).toBe(1);
  });

  it("returns priority 5 for adzuna", () => {
    expect(getParserPriority("adzuna")).toBe(5);
  });

  it("returns lowest priority for null (no parser)", () => {
    expect(getParserPriority(null)).toBe(6);
  });

  it("returns lowest priority for unknown parser names", () => {
    expect(getParserPriority("unknown-parser")).toBe(6);
  });
});

describe("dedupeByUrl", () => {
  it("removes duplicate URLs within the batch, keeping the first occurrence", () => {
    const items = [
      { id: "a", url: "https://example.com/1" },
      { id: "b", url: "https://example.com/2" },
      { id: "c", url: "https://example.com/1" },
    ];
    const result = dedupeByUrl(items, (item) => item.url, new Set());
    expect(result.kept).toEqual([
      { id: "a", url: "https://example.com/1" },
      { id: "b", url: "https://example.com/2" },
    ]);
    expect(result.droppedBatchDupes).toBe(1);
    expect(result.droppedDbMatches).toBe(0);
  });

  it("removes items whose URL matches the known DB set", () => {
    const items = [
      { id: "a", url: "https://example.com/1" },
      { id: "b", url: "https://example.com/2" },
    ];
    const knownUrls = new Set(["https://example.com/1"]);
    const result = dedupeByUrl(items, (item) => item.url, knownUrls);
    expect(result.kept).toEqual([{ id: "b", url: "https://example.com/2" }]);
    expect(result.droppedBatchDupes).toBe(0);
    expect(result.droppedDbMatches).toBe(1);
  });

  it("handles both batch dupes and DB matches together", () => {
    const items = [
      { id: "a", url: "https://example.com/1" },
      { id: "b", url: "https://example.com/2" },
      { id: "c", url: "https://example.com/1" },
    ];
    const knownUrls = new Set(["https://example.com/2"]);
    const result = dedupeByUrl(items, (item) => item.url, knownUrls);
    expect(result.kept).toEqual([{ id: "a", url: "https://example.com/1" }]);
    expect(result.droppedBatchDupes).toBe(1);
    expect(result.droppedDbMatches).toBe(1);
  });

  it("returns empty when all items are duplicates", () => {
    const items = [{ id: "a", url: "https://example.com/1" }];
    const knownUrls = new Set(["https://example.com/1"]);
    const result = dedupeByUrl(items, (item) => item.url, knownUrls);
    expect(result.kept).toEqual([]);
    expect(result.droppedDbMatches).toBe(1);
  });

  it("skips items where accessor returns null or undefined", () => {
    const items = [
      { id: "a", url: "https://example.com/1" },
      { id: "b", url: null as string | null },
    ];
    const result = dedupeByUrl(items, (item) => item.url, new Set());
    expect(result.kept).toEqual([
      { id: "a", url: "https://example.com/1" },
      { id: "b", url: null },
    ]);
  });
});

// Helper: builds a minimal ContentDedupeItem
function makeItem(overrides: Partial<ContentDedupeItem> = {}): ContentDedupeItem {
  return {
    url: "https://boards.greenhouse.io/acme/123",
    title: "Product Designer",
    companyName: "Acme Corp",
    location: "Remote",
    workMode: "remote",
    salaryRange: "$120-$150k",
    source: "greenhouse",
    parser: "greenhouse",
    originalUrl: "https://boards.greenhouse.io/acme/123",
    dates: ["2026-05-01"],
    ...overrides,
  };
}

describe("dedupeByContent — within batch", () => {
  it("keeps the higher-priority parser when two batch items share title+company", () => {
    const items = [
      makeItem({ url: "https://adzuna.com/1", parser: "adzuna", source: "adzuna" }),
      makeItem({ url: "https://boards.greenhouse.io/acme/123", parser: "greenhouse", source: "greenhouse" }),
    ];
    const result = dedupeByContent(items, []);
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].parser).toBe("greenhouse");
  });

  it("pools dates from losers into winner", () => {
    const items = [
      makeItem({ url: "https://gh.io/1", parser: "greenhouse", dates: ["2026-04-15"] }),
      makeItem({ url: "https://adz.io/1", parser: "adzuna", dates: ["2026-05-01"] }),
    ];
    const result = dedupeByContent(items, []);
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].parser).toBe("greenhouse");
    expect(result.kept[0].dates).toContain("2026-04-15");
    expect(result.kept[0].dates).toContain("2026-05-01");
  });

  it("keeps first item when same parser (priority is sole factor)", () => {
    const items = [
      makeItem({ url: "https://gh.io/1", parser: "greenhouse", dates: ["2026-04-15"] }),
      makeItem({ url: "https://gh.io/2", parser: "greenhouse", dates: ["2026-05-01"] }),
    ];
    const result = dedupeByContent(items, []);
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].url).toBe("https://gh.io/1");
    expect(result.kept[0].dates).toContain("2026-04-15");
    expect(result.kept[0].dates).toContain("2026-05-01");
  });

  it("merges fields — winner gets loser's data for empty fields", () => {
    const items = [
      makeItem({ url: "https://gh.io/1", parser: "greenhouse", salaryRange: "" }),
      makeItem({ url: "https://adz.io/1", parser: "adzuna", salaryRange: "$100-$130k" }),
    ];
    const result = dedupeByContent(items, []);
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].parser).toBe("greenhouse");
    expect(result.kept[0].salaryRange).toBe("$100-$130k");
  });

  it("handles 3+ duplicates — picks the best from the group", () => {
    const items = [
      makeItem({ url: "https://adz.io/1", parser: "adzuna" }),
      makeItem({ url: "https://lever.co/1", parser: "lever" }),
      makeItem({ url: "https://gh.io/1", parser: "greenhouse" }),
    ];
    const result = dedupeByContent(items, []);
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].parser).toBe("greenhouse");
  });

  it("leaves unrelated jobs untouched", () => {
    const items = [
      makeItem({ title: "Product Designer", companyName: "Acme" }),
      makeItem({ title: "Engineer", companyName: "Beta Inc", url: "https://other.com/1" }),
    ];
    const result = dedupeByContent(items, []);
    expect(result.kept).toHaveLength(2);
  });
});

describe("dedupeByContent — against DB", () => {
  it("replaces lower-priority DB record with higher-priority batch item", () => {
    const items = [makeItem({ parser: "greenhouse" })];
    const dbJobs = [{
      id: "existing-1",
      title: "Product Designer",
      companyName: "Acme Corp",
      parser: "adzuna",
      firstPublished: "2026-05-01",
      repostedAt: null,
      status: "backlog",
    }];
    const result = dedupeByContent(items, dbJobs);
    expect(result.kept).toHaveLength(0);
    expect(result.dbUpdates).toHaveLength(1);
    expect(result.dbUpdates[0].id).toBe("existing-1");
    expect(result.dbUpdates[0].data).not.toHaveProperty("companyName");
  });

  it("same-parser DB match triggers date-only update with pooled dates", () => {
    const items = [makeItem({ parser: "greenhouse", dates: ["2026-05-15"] })];
    const dbJobs = [{
      id: "existing-1",
      title: "Product Designer",
      companyName: "Acme Corp",
      parser: "greenhouse",
      firstPublished: "2026-04-01",
      repostedAt: null,
      status: "backlog",
    }];
    const result = dedupeByContent(items, dbJobs);
    expect(result.dbUpdates).toHaveLength(1);
    expect(result.dbUpdates[0].dates).toContain("2026-05-15");
    expect(result.dbUpdates[0].dates).toContain("2026-04-01");
    expect(result.dbUpdates[0].data).toEqual({});
  });

  it("pools DB repostedAt into dates when present", () => {
    const items = [makeItem({ parser: "greenhouse", dates: ["2026-06-01"] })];
    const dbJobs = [{
      id: "existing-1",
      title: "Product Designer",
      companyName: "Acme Corp",
      parser: "greenhouse",
      firstPublished: "2026-04-01",
      repostedAt: "2026-05-15",
      status: "backlog",
    }];
    const result = dedupeByContent(items, dbJobs);
    expect(result.dbUpdates[0].dates).toContain("2026-06-01");
    expect(result.dbUpdates[0].dates).toContain("2026-04-01");
    expect(result.dbUpdates[0].dates).toContain("2026-05-15");
  });

  it("drops batch item when DB record has higher priority", () => {
    const items = [makeItem({ parser: "adzuna" })];
    const dbJobs = [{
      id: "existing-1",
      title: "Product Designer",
      companyName: "Acme Corp",
      parser: "greenhouse",
      firstPublished: "2026-05-01",
      repostedAt: null,
      status: "backlog",
    }];
    const result = dedupeByContent(items, dbJobs);
    expect(result.kept).toHaveLength(0);
    expect(result.dbUpdates).toHaveLength(0);
    expect(result.droppedByDb).toBe(1);
  });

  it("never touches DB jobs with active statuses", () => {
    const items = [makeItem({ parser: "greenhouse" })];
    const dbJobs = [{
      id: "existing-1",
      title: "Product Designer",
      companyName: "Acme Corp",
      parser: "adzuna",
      firstPublished: "2026-05-01",
      repostedAt: null,
      status: "interview",
    }];
    const result = dedupeByContent(items, dbJobs);
    expect(result.kept).toHaveLength(0);
    expect(result.dbUpdates).toHaveLength(0);
    expect(result.droppedByDb).toBe(1);
  });

  it("merges empty fields from DB record into batch winner", () => {
    const items = [makeItem({ parser: "greenhouse", salaryRange: "" })];
    const dbJobs = [{
      id: "existing-1",
      title: "Product Designer",
      companyName: "Acme Corp",
      parser: "adzuna",
      firstPublished: "2026-05-01",
      repostedAt: null,
      status: "backlog",
      salaryRange: "$100-$130k",
      location: "Austin, TX",
      workMode: "hybrid",
    }];
    const result = dedupeByContent(items, dbJobs);
    expect(result.dbUpdates[0].data.salaryRange).toBe("$100-$130k");
  });
});
