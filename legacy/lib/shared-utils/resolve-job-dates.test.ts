import { describe, it, expect } from "vitest";
import { resolveJobDates } from "./resolve-job-dates";

// Fixed test dates — distinct timestamps for clear assertions
const JAN_01 = new Date("2025-01-01T00:00:00.000Z");
const JAN_05 = new Date("2025-01-05T00:00:00.000Z");
const JAN_10 = new Date("2025-01-10T00:00:00.000Z");
const JAN_15 = new Date("2025-01-15T00:00:00.000Z");

describe("resolveJobDates", () => {
  describe("first insert (current: null)", () => {
    it("sets firstPublished to the single date, repostedAt null", () => {
      const result = resolveJobDates(null, [JAN_05]);
      expect(result.firstPublished).toEqual(JAN_05);
      expect(result.repostedAt).toBeNull();
    });

    it("sets oldest as firstPublished, newest as repostedAt", () => {
      const result = resolveJobDates(null, [JAN_10, JAN_05]);
      expect(result.firstPublished).toEqual(JAN_05);
      expect(result.repostedAt).toEqual(JAN_10);
    });
  });

  describe("update (current provided)", () => {
    it("keeps firstPublished, sets repostedAt to newer date", () => {
      const current = { firstPublished: JAN_05, repostedAt: null };
      const result = resolveJobDates(current, [JAN_10]);
      expect(result.firstPublished).toEqual(JAN_05);
      expect(result.repostedAt).toEqual(JAN_10);
    });

    it("updates firstPublished to older date, moves old firstPublished to repostedAt", () => {
      const current = { firstPublished: JAN_05, repostedAt: null };
      const result = resolveJobDates(current, [JAN_01]);
      expect(result.firstPublished).toEqual(JAN_01);
      expect(result.repostedAt).toEqual(JAN_05);
    });

    it("returns unchanged when same date as firstPublished is passed", () => {
      const current = { firstPublished: JAN_05, repostedAt: null };
      const result = resolveJobDates(current, [JAN_05]);
      expect(result.firstPublished).toEqual(JAN_05);
      expect(result.repostedAt).toBeNull();
    });

    it("sets oldest and newest from pool when one older and one newer date passed", () => {
      const current = { firstPublished: JAN_05, repostedAt: null };
      const result = resolveJobDates(current, [JAN_01, JAN_10]);
      expect(result.firstPublished).toEqual(JAN_01);
      expect(result.repostedAt).toEqual(JAN_10);
    });

    it("keeps firstPublished, updates repostedAt to newest when both dates are newer", () => {
      const current = { firstPublished: JAN_05, repostedAt: null };
      const result = resolveJobDates(current, [JAN_10, JAN_15]);
      expect(result.firstPublished).toEqual(JAN_05);
      expect(result.repostedAt).toEqual(JAN_15);
    });

    it("updates firstPublished to oldest, keeps repostedAt when both dates are older", () => {
      // Current has both dates set — new dates are both older than firstPublished
      const current = { firstPublished: JAN_10, repostedAt: JAN_15 };
      const result = resolveJobDates(current, [JAN_01, JAN_05]);
      expect(result.firstPublished).toEqual(JAN_01);
      expect(result.repostedAt).toEqual(JAN_15);
    });

    it("promotes old firstPublished to repostedAt when both new dates are older and no existing repostedAt", () => {
      const current = { firstPublished: JAN_10, repostedAt: null };
      const result = resolveJobDates(current, [JAN_01, JAN_05]);
      expect(result.firstPublished).toEqual(JAN_01);
      expect(result.repostedAt).toEqual(JAN_10);
    });
  });

  describe("edge cases", () => {
    it("returns current unchanged when newDates is empty", () => {
      const current = { firstPublished: JAN_05, repostedAt: JAN_10 };
      const result = resolveJobDates(current, []);
      expect(result.firstPublished).toEqual(JAN_05);
      expect(result.repostedAt).toEqual(JAN_10);
    });

    it("returns today as firstPublished when current is null and newDates is empty", () => {
      const before = Date.now();
      const result = resolveJobDates(null, []);
      const after = Date.now();
      expect(result.firstPublished.getTime()).toBeGreaterThanOrEqual(before);
      expect(result.firstPublished.getTime()).toBeLessThanOrEqual(after);
      expect(result.repostedAt).toBeNull();
    });
  });
});
