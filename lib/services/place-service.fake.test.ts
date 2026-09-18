import { describe, expect, test } from "vitest";
import { fakePlaceService } from "./place-service.fake";
import type { PlaceRecord } from "./place-service";

const AUSTIN = {
  latitude: 30.2711286,
  longitude: -97.7436995,
  place_type: "city",
  display_name: "Austin, Travis County, Texas, United States",
  outline: null,
};

describe("fakePlaceService: it remembers what it was told", () => {
  test("a place stored is then found", async () => {
    const service = fakePlaceService();
    await service.store("Austin", AUSTIN);
    expect(await service.findByText("Austin")).toEqual({ lookup_text: "Austin", ...AUSTIN });
  });

  test("a place never stored is not found", async () => {
    expect(await fakePlaceService().findByText("Austin")).toBeNull();
  });

  // Criterion 73. What changes between runs is how locations are cut up
  // rather than the map, so an unreadable text is worth trying again.
  test("storing nothing leaves the text unknown", async () => {
    const service = fakePlaceService();
    await service.store("Bad Robot Games", null);
    expect(await service.findByText("Bad Robot Games")).toBeNull();
  });

  test("storing the same text twice leaves one entry", async () => {
    const held: PlaceRecord[] = [];
    const service = fakePlaceService(held);
    await service.store("Dallas", AUSTIN);
    await service.store("Dallas", AUSTIN);
    expect(held).toHaveLength(1);
  });
});

describe("fakePlaceService: a test can start it already holding places", () => {
  // Criterion 71. A place already held costs no request, and a test proving
  // that needs to hand the service a place it never stored itself.
  test("a place handed in at the start is found", async () => {
    const service = fakePlaceService([{ lookup_text: "Austin", ...AUSTIN }]);
    expect(await service.findByText("Austin")).toEqual({ lookup_text: "Austin", ...AUSTIN });
  });

  test("the list handed in is the one written to", async () => {
    const held: PlaceRecord[] = [];
    await fakePlaceService(held).store("Austin", AUSTIN);
    expect(held).toEqual([{ lookup_text: "Austin", ...AUSTIN }]);
  });
});
