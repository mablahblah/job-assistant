import { describe, it, expect } from "vitest";
import { haversineDistanceMiles } from "./haversine";

describe("haversineDistanceMiles", () => {
  it("returns 0 for identical coordinates", () => {
    expect(haversineDistanceMiles(30.2672, -97.7431, 30.2672, -97.7431)).toBe(0);
  });

  it("calculates Austin to Bee Cave (~15 miles)", () => {
    // Austin, TX (30.2672, -97.7431) to Bee Cave, TX (30.3085, -97.9403)
    const distance = haversineDistanceMiles(30.2672, -97.7431, 30.3085, -97.9403);
    expect(distance).toBeGreaterThan(10);
    expect(distance).toBeLessThan(20);
  });

  it("calculates Austin to Dallas (~195 miles)", () => {
    // Austin, TX (30.2672, -97.7431) to Dallas, TX (32.7767, -96.7970)
    const distance = haversineDistanceMiles(30.2672, -97.7431, 32.7767, -96.797);
    expect(distance).toBeGreaterThan(180);
    expect(distance).toBeLessThan(210);
  });

  it("calculates Austin to San Francisco (~1500 miles)", () => {
    // Austin, TX (30.2672, -97.7431) to San Francisco, CA (37.7749, -122.4194)
    const distance = haversineDistanceMiles(30.2672, -97.7431, 37.7749, -122.4194);
    expect(distance).toBeGreaterThan(1400);
    expect(distance).toBeLessThan(1600);
  });
});
