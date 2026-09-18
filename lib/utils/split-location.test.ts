import { describe, expect, test } from "vitest";
import { splitLocation } from "./split-location";
import fixture from "./locations.fixture.json";

// Every distinct location string the old pipeline collected, 772 of them.
// The rules below run over all of it, so a rule that looks right on an
// invented example and wrong on a real posting is caught here.
const LOCATIONS: string[] = fixture;

describe("splitLocation: a location is cut at every delimiter", () => {
  // Criterion 42. Travis County on its own contains the anchor. Glued to Bee
  // Cave it did not, which is the whole reason nothing is glued back on.
  test("a city and its county become two places", () => {
    expect(splitLocation("Bee Cave, Travis County").places).toEqual([
      "Bee Cave",
      "Travis County",
    ]);
  });

  // Criterion 41.
  test.each([
    ["a semicolon", "Austin; Dallas"],
    ["a bullet", "Austin • Dallas"],
    ["a comma", "Austin, Dallas"],
    ["a slash", "Austin / Dallas"],
    ["a pipe", "Austin | Dallas"],
    ["a bracket", "Austin (Dallas)"],
    ["a colon", "Austin: Dallas"],
    ["a spaced dash", "Austin - Dallas"],
    ["the word or", "Austin or Dallas"],
  ])("%s cuts the location", (_name, raw) => {
    expect(splitLocation(raw).places).toEqual(["Austin", "Dallas"]);
  });

  test("a single place is returned on its own", () => {
    expect(splitLocation("Austin").places).toEqual(["Austin"]);
  });

  // Criterion 49. Of 796 fragments only ten landed within thirty miles of the
  // anchor, and every one was a real Austin-area place, so a fragment naming
  // nothing on a map is harmless noise rather than a risk.
  test("a fragment naming nothing on a map is still kept", () => {
    expect(splitLocation("Bad Robot Games, Santa Monica").places).toEqual([
      "Bad Robot Games",
      "Santa Monica",
    ]);
  });

  test("the same place named twice is kept once", () => {
    expect(splitLocation("Austin, Austin").places).toEqual(["Austin"]);
  });

  test("an empty location yields no places", () => {
    expect(splitLocation("").places).toEqual([]);
  });
});

describe("splitLocation: a work mode inside a location is lifted out", () => {
  // Criterion 43.
  test("the mode word is not part of the place text", () => {
    expect(splitLocation("Austin (Hybrid)").places).toEqual(["Austin"]);
  });

  // Criterion 44. Without this a job whose location reads only Remote carries
  // no work mode at all.
  test("the mode joins the job's modes", () => {
    expect(splitLocation("Remote").modes).toEqual(["remote"]);
  });

  test("a location naming only a mode yields no place", () => {
    expect(splitLocation("Remote").places).toEqual([]);
  });

  test.each([
    ["remote", "remote"],
    ["Fully Remote", "remote"],
    ["hybrid", "hybrid"],
    ["on-site", "in-person"],
    ["onsite", "in-person"],
    ["on site", "in-person"],
    ["in-office", "in-person"],
    ["in office", "in-person"],
    ["in-person", "in-person"],
  ])("%s reads as the %s mode", (raw, mode) => {
    expect(splitLocation(raw).modes).toEqual([mode]);
  });

  test("two modes in one location both come out", () => {
    expect(splitLocation("Austin (Hybrid) or Remote").modes).toEqual(["remote", "hybrid"]);
  });

  test("one mode named twice is held once", () => {
    expect(splitLocation("Remote - Remote").modes).toEqual(["remote"]);
  });

  test("a location naming no mode yields no mode", () => {
    expect(splitLocation("Austin, TX").modes).toEqual([]);
  });
});

describe("splitLocation: words that surround a place are not part of its name", () => {
  test.each([
    ["open to Austin", "Austin"],
    ["based in Austin", "Austin"],
    ["anywhere in Austin", "Austin"],
    ["located in Austin", "Austin"],
    ["within Austin", "Austin"],
    ["from Austin", "Austin"],
  ])("%s leaves %s", (raw, place) => {
    expect(splitLocation(raw).places).toEqual([place]);
  });

  test.each(["hq", "office", "region", "area", "locations", "no location restrictions"])(
    "%s names a kind of workplace rather than a place, so it is dropped",
    (raw) => {
      expect(splitLocation(raw).places).toEqual([]);
    }
  );

  test("a real place standing beside a workplace word survives", () => {
    expect(splitLocation("Austin HQ, office").places).toEqual(["Austin HQ"]);
  });
});

describe("splitLocation: every real location the pipeline has collected", () => {
  const split = LOCATIONS.map((raw) => ({ raw, result: splitLocation(raw) }));

  test("the fixture holds every distinct location string", () => {
    expect(LOCATIONS.length).toBe(772);
  });

  test("no place comes back empty or padded with spaces", () => {
    for (const { raw, result } of split) {
      for (const place of result.places) {
        expect(place, raw).toBe(place.trim());
        expect(place, raw).not.toBe("");
      }
    }
  });

  test("no place still holds a delimiter it should have been cut at", () => {
    for (const { raw, result } of split) {
      for (const place of result.places) {
        expect(place, raw).not.toMatch(/[;•,/|()]/);
      }
    }
  });

  test("no place still holds a work-mode word", () => {
    for (const { raw, result } of split) {
      for (const place of result.places) {
        expect(place, raw).not.toMatch(/\b(remote|hybrid|on-?site|in-?office|in-?person)\b/i);
      }
    }
  });

  test("no place is named twice on one location", () => {
    for (const { raw, result } of split) {
      const lowered = result.places.map((place) => place.toLowerCase());
      expect(new Set(lowered).size, raw).toBe(lowered.length);
    }
  });

  // Criterion 48. Normalization runs twice on a job, once after collection and
  // once after parsing, and the second pass must not grow the list.
  test("splitting the same location twice gives the same answer", () => {
    for (const { raw, result } of split) {
      expect(splitLocation(raw), raw).toEqual(result);
    }
  });

  // The measured gain from cutting at every delimiter was 32 matches with
  // nothing lost, and that only holds if most locations really do come apart.
  test("most locations yield at least one place", () => {
    const withPlaces = split.filter(({ result }) => result.places.length > 0);
    expect(withPlaces.length / split.length).toBeGreaterThan(0.95);
  });
});
