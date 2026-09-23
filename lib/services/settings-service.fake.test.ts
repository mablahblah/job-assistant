import { describe, expect, test } from "vitest";
import { fakeSettingsService } from "./settings-service.fake";

// A fake standing in for a setting has to answer something a caller can work
// with. Zero is not a blank for any of these: a zero expiry threshold expires
// every job, a zero radius puts every job out of reach, and a zero lane width
// resolves nothing. A test that did not care about a setting used to be handed
// an instruction rather than a value.

describe("the numbers the fake answers are usable values, not zeroes", () => {
  const settings = fakeSettingsService();

  test.each([
    ["the radius", () => settings.getRadius()],
    ["the expiry threshold", () => settings.getExpiryThreshold()],
    ["the repost gap", () => settings.getRepostGapDays()],
    ["the fast lane's width", () => settings.getResolutionFastConcurrency()],
    ["the slow lane's width", () => settings.getResolutionSlowConcurrency()],
    ["the slow lane's pause", () => settings.getResolutionSlowPauseSeconds()],
  ])("%s is greater than zero", async (_name, read) => {
    expect(await read()).toBeGreaterThan(0);
  });
});

describe("the lists and text the fake answers are filled", () => {
  const settings = fakeSettingsService();

  test("the location names somewhere", async () => {
    expect(await settings.getLocation()).not.toBe("");
  });

  test("the search terms are not empty", async () => {
    expect(await settings.getSearchTerms()).not.toEqual([]);
  });

  // The seeded list, so a test that never mentions it still keeps two
  // UltiPro jobs apart the way a real run does.
  test("the identifying query values name UltiPro's job identifier", async () => {
    expect(await settings.getIdentifyingQueryValues()).toEqual(["opportunityid"]);
  });
});

// The whole point of the fake: a test says what it cares about and inherits
// the rest.
describe("an override still wins", () => {
  test("a setting a test names is the one it gets", async () => {
    const settings = fakeSettingsService({ getExpiryThreshold: async () => 90 });

    expect(await settings.getExpiryThreshold()).toBe(90);
  });

  test("a setting a test names empty is answered empty", async () => {
    const settings = fakeSettingsService({ getTitleHeadNouns: async () => [] });

    expect(await settings.getTitleHeadNouns()).toEqual([]);
  });
});
