import { describe, expect, test } from "vitest";
import { matchLocation, type MatchablePlace } from "./location-match";

// 30.2711, -97.7437 is 78701, the seeded home location, and thirty miles is
// the seeded radius.
const HOME = { latitude: 30.2711, longitude: -97.7437 };
const RADIUS_MILES = 30;

// A square covering central Texas, which contains the anchor.
const AROUND_HOME = {
  type: "Polygon",
  coordinates: [
    [
      [-98, 30],
      [-97, 30],
      [-97, 31],
      [-98, 31],
      [-98, 30],
    ],
  ],
};

// A place whose middle is three miles away, well inside the radius.
const NEARBY: MatchablePlace = {
  lookup_text: "Tarrytown",
  latitude: 30.3083,
  longitude: -97.77,
  outline: null,
};

// A place whose middle is about 182 miles away, well outside it.
const FAR: MatchablePlace = {
  lookup_text: "Dallas",
  latitude: 32.7767,
  longitude: -96.797,
  outline: null,
};

// A place whose middle is far away but whose outline holds the anchor — a
// country, a state, a region. This is the case containment exists for.
const WIDE: MatchablePlace = {
  lookup_text: "Texas",
  latitude: 31.2638905,
  longitude: -98.5456116,
  outline: AROUND_HOME,
};

function match(places: MatchablePlace[], modes: string[]) {
  return matchLocation({ places, modes, home: HOME, radiusMiles: RADIUS_MILES });
}

describe("matchLocation: every place is paired with every mode", () => {
  // Criterion 55. A posting offering several ways of working is judged on
  // its best, so one pair passing is enough.
  test("one pair passing makes the job match", () => {
    expect(match([FAR, NEARBY], ["in-person"]).matched).toBe(true);
  });

  test("no pair passing makes the job not match", () => {
    expect(match([FAR], ["in-person"]).matched).toBe(false);
  });

  // Criterion 53. A job carrying no mode is judged as though its mode were
  // unknown, rather than not judged at all.
  test("a job holding no mode is still judged", () => {
    expect(match([NEARBY], []).matched).toBe(true);
  });

  // Criterion 54. Without a place there is nothing to measure against, so
  // only a remote pair can pass, and that is the next block's business.
  test("a job holding no place and no remote mode does not match", () => {
    expect(match([], ["in-person"]).matched).toBe(false);
  });
});

describe("matchLocation: a remote pair", () => {
  // Criterion 56. A role open across a country the user lives in is not
  // turned down for the country being large.
  test("matches when the user is inside the place, however far its middle is", () => {
    expect(match([WIDE], ["remote"]).matched).toBe(true);
  });

  // Criterion 57. A remote role anchored to a suburb twelve miles away is
  // not turned down for failing containment.
  test("matches when the place is inside the radius", () => {
    expect(match([NEARBY], ["remote"]).matched).toBe(true);
  });

  // Criterion 58.
  test("does not match when the place neither contains the user nor is near", () => {
    expect(match([FAR], ["remote"]).matched).toBe(false);
  });

  // Criterion 62. A job saying only "remote" and naming no place at all is
  // work the user could do from home.
  test("matches when the job names no place at all", () => {
    expect(match([], ["remote"]).matched).toBe(true);
  });
});

describe("matchLocation: a hybrid or in-person pair", () => {
  // Criterion 59. An office the user cannot reach is never accepted for
  // sitting inside a region they live in.
  test.each(["hybrid", "in-person"])(
    "%s does not match on containment alone",
    (mode) => {
      expect(match([WIDE], [mode]).matched).toBe(false);
    }
  );

  // Criterion 60.
  test.each(["hybrid", "in-person"])("%s matches inside the radius", (mode) => {
    expect(match([NEARBY], [mode]).matched).toBe(true);
  });

  test.each(["hybrid", "in-person"])("%s does not match outside it", (mode) => {
    expect(match([FAR], [mode]).matched).toBe(false);
  });
});

describe("matchLocation: an unknown pair", () => {
  // Criterion 61. Either test can make it match, because nothing is known
  // about how the role is worked.
  test("matches on containment", () => {
    expect(match([WIDE], []).matched).toBe(true);
  });

  test("matches on distance", () => {
    expect(match([NEARBY], []).matched).toBe(true);
  });

  test("does not match on neither", () => {
    expect(match([FAR], []).matched).toBe(false);
  });
});

describe("matchLocation: which place and mode the job records", () => {
  // Criterion 67. A job passing on both a nearby city and a whole country
  // shows the city.
  test("the nearest matching place wins", () => {
    expect(match([WIDE, NEARBY], ["remote"]).place).toBe("Tarrytown");
  });

  test("the order the places came in does not change the winner", () => {
    expect(match([NEARBY, WIDE], ["remote"]).place).toBe("Tarrytown");
  });

  // Criterion 68.
  test("the winning pair's mode is the one recorded", () => {
    expect(match([WIDE], ["remote"]).mode).toBe("remote");
  });

  test("a job that matched on no mode at all records an unknown one", () => {
    expect(match([NEARBY], []).mode).toBeNull();
  });

  // Criterion 118. Two places the same distance away are settled by list
  // order, which decides only which name is shown.
  test("a tie is settled by the earlier place in the list", () => {
    const twin: MatchablePlace = { ...NEARBY, lookup_text: "Tarrytown Twin" };
    expect(match([NEARBY, twin], ["remote"]).place).toBe("Tarrytown");
    expect(match([twin, NEARBY], ["remote"]).place).toBe("Tarrytown Twin");
  });

  test("a job that matched nothing records no place and no mode", () => {
    const result = match([FAR], ["in-person"]);
    expect(result.place).toBeNull();
    expect(result.mode).toBeNull();
  });

  test("a remote job matching with no place at all records no place", () => {
    expect(match([], ["remote"]).place).toBeNull();
  });
});

describe("matchLocation: the settings it measures against", () => {
  // Criterion 69. Where the user lives is a setting, so no judgement carries
  // its own copy of it.
  test("moving the user moves the answer", () => {
    const fromDallas = matchLocation({
      places: [FAR],
      modes: ["in-person"],
      home: { latitude: 32.7767, longitude: -96.797 },
      radiusMiles: RADIUS_MILES,
    });
    expect(fromDallas.matched).toBe(true);
  });

  test("widening the radius widens the answer", () => {
    const wide = matchLocation({
      places: [FAR],
      modes: ["in-person"],
      home: HOME,
      radiusMiles: 300,
    });
    expect(wide.matched).toBe(true);
  });

  // Criterion 116. Only the coordinates and the outline are read from a
  // stored place, so a place's name and type never sway the answer.
  test("a place named after the user's own city but far away does not match", () => {
    const namesake: MatchablePlace = { ...FAR, lookup_text: "Austin" };
    expect(match([namesake], ["in-person"]).matched).toBe(false);
  });
});
