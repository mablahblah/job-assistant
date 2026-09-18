import { describe, expect, test } from "vitest";
import { pointInShape, type MapShape } from "./point-in-shape";
import boundaries from "./boundaries.fixture.json";

// 30.2711, -97.7437 is 78701, the anchor every measurement in this project was
// taken from.
const ANCHOR = { latitude: 30.2711, longitude: -97.7437 };

// Shapes fetched from the live mapping service during planning and committed
// here, so these run offline and still prove the real thing. The research
// folder keeps its own copy as part of that record; this one is the test's,
// beside the code it covers like every other fixture.
const REAL: Record<string, { geojson: MapShape | null }> = boundaries;

function outlineOf(place: string): MapShape | null {
  const entry = REAL[place];
  if (entry === undefined) throw new Error(`boundaries.json holds no entry for ${place}`);
  return entry.geojson;
}

// A square from (0,0) to (10,10), written as GeoJSON does: longitude first.
const SQUARE: MapShape = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ],
  ],
};

describe("pointInShape: an area decides containment", () => {
  test("a point inside the outline is contained", () => {
    expect(pointInShape(5, 5, SQUARE)).toBe(true);
  });

  test("a point outside the outline is not contained", () => {
    expect(pointInShape(20, 5, SQUARE)).toBe(false);
  });
});

describe("pointInShape: an outline holding a hole", () => {
  // Criterion 66. A state riddled with lakes is the real case.
  const RING: MapShape = {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
      [
        [4, 4],
        [6, 4],
        [6, 6],
        [4, 6],
        [4, 4],
      ],
    ],
  };

  test("a point in the solid part is contained", () => {
    expect(pointInShape(1, 1, RING)).toBe(true);
  });

  test("a point inside the hole is not contained", () => {
    expect(pointInShape(5, 5, RING)).toBe(false);
  });
});

describe("pointInShape: an outline in several pieces", () => {
  // Criterion 65. A state made of islands is the real case.
  const ISLANDS: MapShape = {
    type: "MultiPolygon",
    coordinates: [
      [
        [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
          [0, 0],
        ],
      ],
      [
        [
          [10, 10],
          [12, 10],
          [12, 12],
          [10, 12],
          [10, 10],
        ],
      ],
    ],
  };

  test("a point in the first piece is contained", () => {
    expect(pointInShape(1, 1, ISLANDS)).toBe(true);
  });

  test("a point in a later piece is contained", () => {
    expect(pointInShape(11, 11, ISLANDS)).toBe(true);
  });

  test("a point in neither piece is not contained", () => {
    expect(pointInShape(5, 5, ISLANDS)).toBe(false);
  });
});

describe("pointInShape: anything that is not an area contains nothing", () => {
  // Criterion 64. Only an area can contain anything, so a line or a point
  // falls back on distance rather than being read as a container.
  test.each([
    ["a point", { type: "Point", coordinates: [5, 5] }],
    [
      "a line",
      {
        type: "LineString",
        coordinates: [
          [0, 0],
          [10, 10],
        ],
      },
    ],
  ])("%s contains nothing", (_label, shape) => {
    expect(pointInShape(5, 5, shape as MapShape)).toBe(false);
  });

  test("no outline at all contains nothing", () => {
    expect(pointInShape(5, 5, null)).toBe(false);
  });
});

describe("pointInShape: the real outlines the mapping service returned", () => {
  // Criterion 63. Verified against the live service during planning: these
  // four contain the anchor and those four do not. Mexico is the case a
  // rectangle drawn round a place gets wrong.
  test.each(["United States", "Texas", "Travis County", "Austin"])(
    "%s contains the anchor",
    (place) => {
      expect(pointInShape(ANCHOR.longitude, ANCHOR.latitude, outlineOf(place))).toBe(true);
    }
  );

  test.each(["California", "Mexico", "Philadelphia", "Saint Johns County"])(
    "%s does not contain the anchor",
    (place) => {
      expect(pointInShape(ANCHOR.longitude, ANCHOR.latitude, outlineOf(place))).toBe(false);
    }
  );

  // Criterion 64 against real data: the service returns a line for a road and
  // a point for a hamlet, and neither can contain anything.
  test.each(["Mc Neil", "Sprinkle", "Jollyville"])("%s contains nothing", (place) => {
    expect(pointInShape(ANCHOR.longitude, ANCHOR.latitude, outlineOf(place))).toBe(false);
  });

  // Michigan is riddled with lakes and Hawaii is a chain of islands, so these
  // two exercise holes and several pieces against real shapes.
  test.each(["Michigan", "Hawaii"])("%s does not contain a Texas anchor", (place) => {
    expect(pointInShape(ANCHOR.longitude, ANCHOR.latitude, outlineOf(place))).toBe(false);
  });
});
