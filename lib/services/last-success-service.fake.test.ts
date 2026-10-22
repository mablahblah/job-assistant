import { describe, expect, test } from "vitest";
import { fakeLastSuccessService } from "./last-success-service.fake";

// The fake stands in for the real service wherever a collector or handler is
// tested without a database, so it has to reach the same answers the real one
// does. These checks mirror lib/services/last-success-service.test.ts: where
// the two files disagree, the fake is lying and every test that trusts it is
// worthless.

const FIRST_SUCCESS = new Date("2026-10-20T14:00:00.000Z");
const LATER_SUCCESS = new Date("2026-10-21T15:30:00.000Z");

describe("the last-success fake", () => {
  test("a search that never worked has no time", async () => {
    const service = fakeLastSuccessService();
    expect(await service.find("never-worked", "remote")).toBeNull();
  });

  test("a recorded time is found again", async () => {
    const service = fakeLastSuccessService();
    await service.record("recorded", "remote", FIRST_SUCCESS);
    expect(await service.find("recorded", "remote")).toEqual(FIRST_SUCCESS);
  });

  test("a later time replaces the earlier one", async () => {
    const service = fakeLastSuccessService();
    await service.record("replaced", "remote", FIRST_SUCCESS);
    await service.record("replaced", "remote", LATER_SUCCESS);
    expect(await service.find("replaced", "remote")).toEqual(LATER_SUCCESS);
  });

  test("one search's time leaves the other search alone", async () => {
    const service = fakeLastSuccessService();
    await service.record("two-searches", "remote", FIRST_SUCCESS);
    await service.record("two-searches", "austin", LATER_SUCCESS);
    expect(await service.find("two-searches", "remote")).toEqual(FIRST_SUCCESS);
  });

  test("one collector's time leaves another collector's search alone", async () => {
    const service = fakeLastSuccessService();
    await service.record("first-collector", "remote", FIRST_SUCCESS);
    expect(await service.find("second-collector", "remote")).toBeNull();
  });

  // Each fake starts empty, so one test's saved time never leaks into another.
  test("two fakes keep their own times", async () => {
    const first = fakeLastSuccessService();
    const second = fakeLastSuccessService();
    await first.record("separate", "remote", FIRST_SUCCESS);
    expect(await second.find("separate", "remote")).toBeNull();
  });

  test("a caller can override one method", async () => {
    const service = fakeLastSuccessService({ find: async () => LATER_SUCCESS });
    expect(await service.find("overridden", "remote")).toEqual(LATER_SUCCESS);
  });
});
