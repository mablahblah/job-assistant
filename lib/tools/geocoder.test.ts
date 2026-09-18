import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createGeocoder, GEOCODE_PACING_MS } from "./geocoder";

// One result, shaped the way the mapping service really answers.
const AUSTIN = {
  lat: "30.2711286",
  lon: "-97.7436995",
  display_name: "Austin, Travis County, Texas, United States",
  addresstype: "city",
  geojson: { type: "Polygon", coordinates: [[[0, 0]]] },
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("createGeocoder: the request it sends", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env["GEOCODE_MAPS_API_KEY"] = "test-key";
    fetchMock = vi.fn().mockResolvedValue(jsonResponse([AUSTIN]));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function sentUrl(): Promise<URL> {
    await createGeocoder().lookUp("Austin");
    return new URL(String(fetchMock.mock.calls[0]?.[0]));
  }

  test("it asks the mapping service for the place text", async () => {
    expect((await sentUrl()).searchParams.get("q")).toBe("Austin");
  });

  test("it carries the api key", async () => {
    expect((await sentUrl()).searchParams.get("api_key")).toBe("test-key");
  });

  test("it asks for one result, because only the best match is used", async () => {
    expect((await sentUrl()).searchParams.get("limit")).toBe("1");
  });

  // What kind of thing a place is comes back under addressdetails.
  test("it asks for the address detail", async () => {
    expect((await sentUrl()).searchParams.get("addressdetails")).toBe("1");
  });

  // Criterion 63. Without the outline there is nothing to test containment
  // against, and the rule falls back to comparing names.
  test("it asks for the outline", async () => {
    expect((await sentUrl()).searchParams.get("polygon_geojson")).toBe("1");
  });

  // Criterion 77. An unsimplified country outline runs to megabytes, so the
  // service is asked to round it off before sending it.
  test("it asks for the outline to be simplified", async () => {
    expect((await sentUrl()).searchParams.get("polygon_threshold")).toBe("0.01");
  });
});

describe("createGeocoder: what it hands back", () => {
  beforeEach(() => {
    process.env["GEOCODE_MAPS_API_KEY"] = "test-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Criterion 105.
  test("a place that resolved carries its coordinates, type, name and outline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([AUSTIN])));
    expect(await createGeocoder().lookUp("Austin")).toEqual({
      latitude: 30.2711286,
      longitude: -97.7436995,
      place_type: "city",
      display_name: "Austin, Travis County, Texas, United States",
      outline: { type: "Polygon", coordinates: [[[0, 0]]] },
    });
  });

  test("a place with no outline comes back with none rather than failing", async () => {
    const noOutline = { ...AUSTIN, geojson: undefined };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([noOutline])));
    const place = await createGeocoder().lookUp("Sprinkle");
    expect(place?.outline).toBeNull();
  });

  test("a text the service found nothing for comes back empty", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([])));
    expect(await createGeocoder().lookUp("Bad Robot Games")).toBeNull();
  });

  test("an empty text is not sent at all", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await createGeocoder().lookUp("   ")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("createGeocoder: a refusal", () => {
  beforeEach(() => {
    process.env["GEOCODE_MAPS_API_KEY"] = "test-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Criterion 76. Nothing is stored for a refused place, so the same text is
  // tried again next run rather than being remembered as unreadable.
  test.each([429, 403, 500])("a %s comes back empty", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([], status)));
    expect(await createGeocoder().lookUp("Austin")).toBeNull();
  });

  test("a refusal is not retried, because the run cannot afford to wait", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([], 429));
    vi.stubGlobal("fetch", fetchMock);
    await createGeocoder().lookUp("Austin");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("a request that never arrives comes back empty", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    expect(await createGeocoder().lookUp("Austin")).toBeNull();
  });

  test("a missing api key stops the run rather than failing every job quietly", async () => {
    delete process.env["GEOCODE_MAPS_API_KEY"];
    vi.stubGlobal("fetch", vi.fn());
    await expect(createGeocoder().lookUp("Austin")).rejects.toThrow(/GEOCODE_MAPS_API_KEY/);
  });
});

describe("createGeocoder: it paces itself", () => {
  beforeEach(() => {
    process.env["GEOCODE_MAPS_API_KEY"] = "test-key";
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // Criterion 75. The service allows one lookup a second, so the tool holds
  // its own timer rather than trusting every caller to wait.
  test("two lookups are separated by at least the pacing interval", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([AUSTIN]));
    vi.stubGlobal("fetch", fetchMock);
    const geocoder = createGeocoder();

    await geocoder.lookUp("Austin");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = geocoder.lookUp("Dallas");
    await vi.advanceTimersByTimeAsync(GEOCODE_PACING_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("the first lookup of a run waits for nothing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([AUSTIN]));
    vi.stubGlobal("fetch", fetchMock);
    await createGeocoder().lookUp("Austin");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("the pacing interval leaves room under one lookup a second", () => {
    expect(GEOCODE_PACING_MS).toBeGreaterThan(1000);
  });
});
