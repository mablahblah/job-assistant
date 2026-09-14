import { describe, expect, test } from "vitest";
import { fakeGeocoder } from "./geocoder.fake";

const AUSTIN = {
  latitude: 30.2711286,
  longitude: -97.7436995,
  place_type: "city",
  display_name: "Austin, Travis County, Texas, United States",
  outline: null,
};

describe("fakeGeocoder: it answers from a table a test writes", () => {
  test("a place the table names comes back", async () => {
    const geocoder = fakeGeocoder({ Austin: AUSTIN });
    expect(await geocoder.lookUp("Austin")).toEqual(AUSTIN);
  });

  test("a place the table does not name comes back empty", async () => {
    const geocoder = fakeGeocoder({ Austin: AUSTIN });
    expect(await geocoder.lookUp("Bad Robot Games")).toBeNull();
  });

  // Criterion 78. The whole point of the fake: nothing in the suite reaches a
  // real mapping service, so a run of the tests costs no requests and cannot
  // be slowed down by a service refusing them.
  test("an empty table answers nothing at all", async () => {
    expect(await fakeGeocoder().lookUp("Austin")).toBeNull();
  });
});

describe("fakeGeocoder: it records what it was asked", () => {
  test("every text it was handed is kept, in order", async () => {
    const geocoder = fakeGeocoder({ Austin: AUSTIN });
    await geocoder.lookUp("Austin");
    await geocoder.lookUp("Dallas");
    expect(geocoder.lookedUp).toEqual(["Austin", "Dallas"]);
  });

  test("a text it found nothing for is still recorded", async () => {
    const geocoder = fakeGeocoder();
    await geocoder.lookUp("Bad Robot Games");
    expect(geocoder.lookedUp).toEqual(["Bad Robot Games"]);
  });
});

describe("fakeGeocoder: it can be told to refuse", () => {
  // Edge case 13. A service that refuses part way through a run has to be
  // testable, and a refusal is not the same as finding nothing.
  test("a table entry set to throw throws", async () => {
    const geocoder = fakeGeocoder({ Austin: new Error("service refused") });
    await expect(geocoder.lookUp("Austin")).rejects.toThrow(/refused/);
  });

  test("the jobs after a refusal are still answered", async () => {
    const geocoder = fakeGeocoder({
      Austin: new Error("service refused"),
      Dallas: AUSTIN,
    });
    await expect(geocoder.lookUp("Austin")).rejects.toThrow();
    expect(await geocoder.lookUp("Dallas")).toEqual(AUSTIN);
  });
});
