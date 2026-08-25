import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma
vi.mock("@/lib/prisma", () => ({
  prisma: {
    locationCache: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    geocodingClassRule: {
      findUnique: vi.fn(),
    },
  },
}));

// Mock the geocode client
vi.mock("./geocode-client", () => ({
  geocodeLocation: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { geocodeLocation } from "./geocode-client";
import { classifyJobLocation, classifyJobLocations } from "./classify-location";

const mockGeocode = geocodeLocation as ReturnType<typeof vi.fn>;
const db = prisma as unknown as {
  locationCache: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  geocodingClassRule: {
    findUnique: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no cache hits, no class rules matched
  db.locationCache.findUnique.mockResolvedValue(null);
  db.locationCache.create.mockResolvedValue({});
  db.geocodingClassRule.findUnique.mockResolvedValue(null);
});

describe("classifyJobLocation", () => {
  it("classifies a cached in-range location as backlog", async () => {
    // Tarrytown coords — 8.7 miles from anchor
    db.locationCache.findUnique.mockResolvedValue({
      lat: 30.3083,
      lon: -97.7700,
      displayName: "Tarrytown, Austin, TX",
    });

    const result = await classifyJobLocation("Tarrytown, Travis County", "hybrid");

    expect(result.status).toBe("backlog");
    expect(result.unknownClasses).toEqual([]);
    expect(mockGeocode).not.toHaveBeenCalled(); // cache hit, no API call
  });

  it("classifies a cached out-of-range location as too far", async () => {
    // Dallas coords — ~175 miles from anchor
    db.locationCache.findUnique.mockResolvedValue({
      lat: 32.7767,
      lon: -96.7970,
      displayName: "Dallas, TX",
    });

    const result = await classifyJobLocation("Dallas, TX", "in-person");

    expect(result.status).toBe("too far");
  });

  it("geocodes a cache miss and caches the result", async () => {
    mockGeocode.mockResolvedValue({
      lat: "30.3083",
      lon: "-97.7700",
      display_name: "Tarrytown, Austin, Travis County, TX",
      class: "place",
      type: "suburb",
      importance: 0.3,
    });
    db.geocodingClassRule.findUnique.mockResolvedValue({ action: "allow" });

    const result = await classifyJobLocation("Tarrytown, Travis County", "hybrid");

    expect(result.status).toBe("backlog");
    expect(mockGeocode).toHaveBeenCalledWith("Tarrytown, Travis County");
    expect(db.locationCache.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        locationString: "Tarrytown, Travis County",
        lat: 30.3083,
        lon: -97.7700,
      }),
    });
  });

  it("returns backlog for unresolvable location (false positive preference)", async () => {
    mockGeocode.mockResolvedValue(null);

    const result = await classifyJobLocation("Mc Neil, Travis County", "hybrid");

    expect(result.status).toBe("backlog");
    expect(db.locationCache.create).not.toHaveBeenCalled(); // unresolvable not cached
  });

  it("returns backlog for blocked class (bogus result)", async () => {
    mockGeocode.mockResolvedValue({
      lat: "30.0",
      lon: "-97.0",
      display_name: "NYC Caribbean",
      class: "amenity",
      type: "fast_food",
      importance: 0.0,
    });
    db.geocodingClassRule.findUnique.mockResolvedValue({ action: "block" });

    const result = await classifyJobLocation("Dallas, TX", "hybrid");

    expect(result.status).toBe("backlog");
    expect(db.locationCache.create).not.toHaveBeenCalled(); // blocked not cached
  });

  it("returns backlog and flags unknown class", async () => {
    mockGeocode.mockResolvedValue({
      lat: "30.0",
      lon: "-97.0",
      display_name: "Some Park",
      class: "leisure",
      type: "park",
      importance: 0.2,
    });
    // No rule for "leisure"
    db.geocodingClassRule.findUnique.mockResolvedValue(null);

    const result = await classifyJobLocation("Some Park", "hybrid");

    expect(result.status).toBe("backlog");
    expect(result.unknownClasses).toEqual([
      { className: "leisure", locationString: "Some Park", displayName: "Some Park" },
    ]);
    expect(db.locationCache.create).not.toHaveBeenCalled(); // unknown not cached
  });

  it("skips geocoding for remote jobs", async () => {
    const result = await classifyJobLocation("Anywhere", "remote");

    expect(result.status).toBe("skip");
    expect(mockGeocode).not.toHaveBeenCalled();
  });

  it("handles multi-location — near if any fragment in range", async () => {
    // First fragment: Austin (near). Second fragment: NYC (far).
    // Both are cache misses.
    mockGeocode
      .mockResolvedValueOnce({
        lat: "30.2672",
        lon: "-97.7431",
        display_name: "Austin, TX",
        class: "place",
        type: "city",
        importance: 0.7,
      })
      .mockResolvedValueOnce({
        lat: "40.7128",
        lon: "-74.0060",
        display_name: "New York, NY",
        class: "place",
        type: "city",
        importance: 0.9,
      });
    db.geocodingClassRule.findUnique.mockResolvedValue({ action: "allow" });

    const result = await classifyJobLocation("Austin, TX; New York, NY", "hybrid");

    expect(result.status).toBe("backlog");
  });

  it("handles multi-location — too far if all fragments out of range", async () => {
    mockGeocode
      .mockResolvedValueOnce({
        lat: "40.7128",
        lon: "-74.0060",
        display_name: "New York, NY",
        class: "place",
        type: "city",
        importance: 0.9,
      })
      .mockResolvedValueOnce({
        lat: "37.7749",
        lon: "-122.4194",
        display_name: "San Francisco, CA",
        class: "place",
        type: "city",
        importance: 0.8,
      });
    db.geocodingClassRule.findUnique.mockResolvedValue({ action: "allow" });

    const result = await classifyJobLocation("New York, NY; San Francisco, CA", "hybrid");

    expect(result.status).toBe("too far");
  });

  it("handles empty location as backlog", async () => {
    const result = await classifyJobLocation("", "hybrid");

    expect(result.status).toBe("backlog");
    expect(mockGeocode).not.toHaveBeenCalled();
  });

  it("handles prefilter skip (bare Remote on non-remote job) as backlog", async () => {
    const result = await classifyJobLocation("Remote", "hybrid");

    expect(result.status).toBe("backlog");
    expect(mockGeocode).not.toHaveBeenCalled();
  });
});

describe("classifyJobLocations", () => {
  it("deduplicates unknown classes across jobs", async () => {
    // Reset geocode mock fully to avoid leakage from prior tests
    mockGeocode.mockReset();
    // Both jobs produce the same unknown class "leisure"
    mockGeocode.mockResolvedValue({
      lat: "30.0",
      lon: "-97.0",
      display_name: "Some Park",
      class: "leisure",
      type: "park",
      importance: 0.2,
    });
    db.geocodingClassRule.findUnique.mockResolvedValue(null);

    const { results, allUnknownClasses } = await classifyJobLocations([
      { location: "Park A", workMode: "hybrid" },
      { location: "Park B", workMode: "hybrid" },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0].status).toBe("backlog");
    expect(results[1].status).toBe("backlog");
    // Only one unique unknown class despite two jobs triggering it
    expect(allUnknownClasses).toHaveLength(1);
    expect(allUnknownClasses[0].className).toBe("leisure");
  });

  it("preserves result order matching input order", async () => {
    // First job: remote (skip), Second job: cached in-range (backlog)
    db.locationCache.findUnique.mockResolvedValueOnce({
      lat: 30.3083,
      lon: -97.7700,
      displayName: "Tarrytown, Austin, TX",
    });

    const { results } = await classifyJobLocations([
      { location: "Anywhere", workMode: "remote" },
      { location: "Tarrytown, TX", workMode: "hybrid" },
    ]);

    expect(results[0].status).toBe("skip");
    expect(results[1].status).toBe("backlog");
  });
});
