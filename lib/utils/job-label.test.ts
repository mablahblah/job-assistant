// Every warning naming a job goes through this, so what it prints is what
// the user has to recognise the job by. The fallbacks matter more than the
// happy path: a job reaches a warning line precisely when something about it
// went wrong, which is also when its title is most likely to be missing.
import { describe, expect, test } from "vitest";
import { labelJob } from "./job-label";
import type { JobListEntry } from "../types/job-list-entry";

function job(overrides: Partial<JobListEntry> = {}): JobListEntry {
  return { id: "job-1", ...overrides };
}

describe("naming a job in a warning line", () => {
  test("the normalized title is used where there is one", () => {
    expect(labelJob(job({ title: "Senior Product Designer", raw_title: "Sr. Prod Des" }))).toContain(
      "Senior Product Designer"
    );
  });

  test("the raw title stands in where normalization left none", () => {
    expect(labelJob(job({ raw_title: "Sr. Prod Des" }))).toContain("Sr. Prod Des");
  });

  // Both fields can arrive as an empty string rather than absent, and an
  // empty string names nothing.
  test("an empty normalized title falls back to the raw one", () => {
    expect(labelJob(job({ title: "", raw_title: "Sr. Prod Des" }))).toContain("Sr. Prod Des");
  });

  test("a title of nothing but spaces falls back to the raw one", () => {
    expect(labelJob(job({ title: "   ", raw_title: "Sr. Prod Des" }))).toContain("Sr. Prod Des");
  });

  test("a job with no title at all is still named something", () => {
    expect(labelJob(job())).toContain("unlabeled job");
  });

  test("a job whose raw title is also empty is still named something", () => {
    expect(labelJob(job({ title: "", raw_title: "" }))).toContain("unlabeled job");
  });

  // A source's stray whitespace would otherwise show up in the printed line.
  test("surrounding spaces are trimmed off the title", () => {
    expect(labelJob(job({ title: "  Product Designer  " }))).toBe("Product Designer (id: job-1)");
  });

  // Two jobs can carry the same title, so the id is what tells them apart.
  test("the id is carried alongside the title", () => {
    expect(labelJob(job({ id: "abc-123", title: "Product Designer" }))).toBe(
      "Product Designer (id: abc-123)"
    );
  });

  // A job reaches here with no id only through a write that failed before its
  // row existed, which is the thing the warning is reporting.
  test("a job that never got an id says so rather than printing nothing", () => {
    expect(labelJob({ title: "Product Designer" })).toBe("Product Designer (id: unknown)");
  });
});
