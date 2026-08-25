import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fetch before importing the module
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { geocodeLocation, _resetForTesting } from "./geocode-client";

// Helpers to build mock responses
function okResponse(data: unknown[]) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
    headers: new Headers(),
  };
}

function rateLimitResponse(retryAfter?: string) {
  const headers = new Headers();
  if (retryAfter) headers.set("Retry-After", retryAfter);
  return { ok: false, status: 429, headers };
}

function errorResponse(status: number) {
  return { ok: false, status, headers: new Headers() };
}

const SAMPLE_RESULT = {
  lat: "30.2672",
  lon: "-97.7431",
  display_name: "Austin, TX",
  class: "place",
  type: "city",
  importance: 0.7,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  _resetForTesting();
  vi.stubEnv("GEOCODE_MAPS_API_KEY", "stub");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("geocodeLocation", () => {
  it("returns top result on success", async () => {
    mockFetch.mockResolvedValueOnce(okResponse([SAMPLE_RESULT]));
    const result = await geocodeLocation("Austin, TX");
    expect(result).toEqual(SAMPLE_RESULT);
  });

  it("returns null for empty query", async () => {
    const result = await geocodeLocation("");
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns null when API key is missing", async () => {
    vi.stubEnv("GEOCODE_MAPS_API_KEY", "");
    delete process.env.GEOCODE_MAPS_API_KEY;
    const result = await geocodeLocation("Austin, TX");
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns null for empty results array", async () => {
    mockFetch.mockResolvedValueOnce(okResponse([]));
    const result = await geocodeLocation("Austin, TX");
    expect(result).toBeNull();
  });

  it("does not retry non-429 errors", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(500));
    const result = await geocodeLocation("Austin, TX");
    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns null on network error without retrying", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network failed"));
    const result = await geocodeLocation("Austin, TX");
    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 and returns result on success", async () => {
    mockFetch
      .mockResolvedValueOnce(rateLimitResponse())
      .mockResolvedValueOnce(okResponse([SAMPLE_RESULT]));

    const promise = geocodeLocation("Austin, TX");
    // Advance past retry delay + rate limit spacing
    await vi.advanceTimersByTimeAsync(5000);
    const result = await promise;

    expect(result).toEqual(SAMPLE_RESULT);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("gives up after max retries on persistent 429", async () => {
    mockFetch
      .mockResolvedValueOnce(rateLimitResponse())
      .mockResolvedValueOnce(rateLimitResponse())
      .mockResolvedValueOnce(rateLimitResponse());

    const promise = geocodeLocation("Austin, TX");
    await vi.advanceTimersByTimeAsync(15000);
    const result = await promise;

    expect(result).toBeNull();
    // 1 original + 2 retries = 3 total attempts
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("respects Retry-After header on 429", async () => {
    mockFetch
      .mockResolvedValueOnce(rateLimitResponse("2"))
      .mockResolvedValueOnce(okResponse([SAMPLE_RESULT]));

    const promise = geocodeLocation("Austin, TX");
    await vi.advanceTimersByTimeAsync(5000);
    const result = await promise;

    expect(result).toEqual(SAMPLE_RESULT);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe("rate limiting", () => {
  it("delays second call made immediately after the first", async () => {
    mockFetch.mockResolvedValue(okResponse([SAMPLE_RESULT]));

    // First call — no rate limit wait needed
    const r1 = await geocodeLocation("Austin, TX");
    expect(r1).toEqual(SAMPLE_RESULT);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Second call starts immediately — rate limiter should hold it
    const promise = geocodeLocation("Dallas, TX");

    // fetch should NOT have been called again yet (blocked by rate limiter)
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Advance past the rate limit interval
    await vi.advanceTimersByTimeAsync(1200);
    await promise;

    // Now the second fetch should have fired
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
