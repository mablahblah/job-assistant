import { describe, it, expect } from "vitest";
import { haversineDistanceMiles } from "./haversine";

describe("haversineDistanceMiles", () => {
  // Anchor: center of 78701 (30.2711, -97.7437)
  const anchor = { lat: 30.2711, lon: -97.7437 };

  it("returns 0 for same point", () => {
    expect(haversineDistanceMiles(anchor.lat, anchor.lon, anchor.lat, anchor.lon)).toBe(0);
  });

  it("Austin to Dallas is ~175-190 miles", () => {
    const dist = haversineDistanceMiles(anchor.lat, anchor.lon, 32.7767, -96.7970);
    expect(dist).toBeGreaterThan(175);
    expect(dist).toBeLessThan(190);
  });

  it("Austin to Tarrytown is within 30 miles", () => {
    // Tarrytown: 30.3083, -97.7700 (3.0mi from the anchor)
    const dist = haversineDistanceMiles(anchor.lat, anchor.lon, 30.3083, -97.7700);
    expect(dist).toBeLessThan(30);
  });

  it("Austin to San Francisco is >1400 miles", () => {
    const dist = haversineDistanceMiles(anchor.lat, anchor.lon, 37.7749, -122.4194);
    expect(dist).toBeGreaterThan(1400);
  });
});
