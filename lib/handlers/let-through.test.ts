import { describe, expect, test } from "vitest";
import { letJobsThrough } from "./let-through";
import type { JobListEntry } from "../types/job-list-entry";

// Covers what the step does to the jobs it is handed. The trace rows it
// writes keep their own coverage in let-through-events.test.ts and are not
// re-asserted here.

const COLLECTED = new Date("2026-09-14T12:00:00.000Z");

function entry(id: string, overrides: JobListEntry = {}): JobListEntry {
  return { id, collector: "user", collected_at: COLLECTED, ...overrides };
}

// After page reading, a job with no real place is at unparseable, whether its
// page was refused, empty, or named no place, or its link was never followed.
describe("after page reading", () => {
  test("a job page reading found no place for returns to the backlog", async () => {
    const result = await letJobsThrough([entry("nowhere", { status: "unparseable", is_parsed: false })], {
      after: "parsing",
    });

    expect(result.jobs[0]?.status).toBe("backlog");
  });

  // Scoring takes only backlog jobs done at all three, and the location check
  // takes only jobs not yet checked, so marking all three sends the job to
  // scoring without the location check judging a job it knows nothing about.
  test("that job is marked followed, read and location-checked", async () => {
    const result = await letJobsThrough([entry("nowhere", { status: "unparseable", is_parsed: false })], {
      after: "parsing",
    });

    expect(result.jobs[0]).toMatchObject({ is_resolved: true, is_parsed: true, is_classified: true });
  });

  test("a job page reading read is left as it was", async () => {
    const read = entry("read", { is_parsed: true, raw_location_list: ["Austin, TX"] });

    const result = await letJobsThrough([read], { after: "parsing" });

    expect(result.jobs[0]).toEqual(read);
  });

  test("a job page reading found dead is left as it was", async () => {
    const dead = entry("dead", { status: "expired", is_parsed: true });

    const result = await letJobsThrough([dead], { after: "parsing" });

    expect(result.jobs[0]).toEqual(dead);
  });
});

// After the location check, a job still in the backlog and unchecked named
// places the map could not find.
describe("after the location check", () => {
  test("a job the location check could not place is marked checked", async () => {
    const result = await letJobsThrough([entry("unplaced")], { after: "classification" });

    expect(result.jobs[0]?.is_classified).toBe(true);
  });

  test("that job stays in the backlog", async () => {
    const result = await letJobsThrough([entry("unplaced", { status: "backlog" })], {
      after: "classification",
    });

    expect(result.jobs[0]?.status).toBe("backlog");
  });

  test("a job the location check judged near enough is left as it was", async () => {
    const near = entry("near", { is_classified: true, location_match: true });

    const result = await letJobsThrough([near], { after: "classification" });

    expect(result.jobs[0]).toEqual(near);
  });

  test("a job the location check judged too far is left as it was", async () => {
    const far = entry("far", { status: "too far", is_classified: true, location_match: false });

    const result = await letJobsThrough([far], { after: "classification" });

    expect(result.jobs[0]).toEqual(far);
  });

  test("a job the location check found too old is left as it was", async () => {
    const old = entry("old", { status: "expired", is_classified: true });

    const result = await letJobsThrough([old], { after: "classification" });

    expect(result.jobs[0]).toEqual(old);
  });
});

describe("the list it hands back", () => {
  test("holds every job it was handed, in order", async () => {
    const result = await letJobsThrough(
      [entry("one", { status: "unparseable" }), entry("two", { is_parsed: true })],
      { after: "parsing" }
    );

    expect(result.jobs.map((job) => job.id)).toEqual(["one", "two"]);
  });

  test("leaves the job it was handed untouched", async () => {
    const handed = entry("nowhere", { status: "unparseable", is_parsed: false });

    await letJobsThrough([handed], { after: "parsing" });

    expect(handed.status).toBe("unparseable");
  });
});
