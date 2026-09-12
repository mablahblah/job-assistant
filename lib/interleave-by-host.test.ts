import { describe, expect, test } from "vitest";
import { interleaveByHost } from "./interleave-by-host";
import type { JobListEntry } from "./job-list-entry";

function job(id: string, url: string | null): JobListEntry {
  return { id, original_url: url, collector: "adzuna" };
}

function ids(jobs: JobListEntry[]): string {
  return jobs.map((entry) => entry.id).join("");
}

describe("dealing the list round-robin by host", () => {
  test("a list already holding one host each comes back unchanged", () => {
    const jobs = [
      job("a", "https://one.example/1"),
      job("b", "https://two.example/1"),
      job("c", "https://three.example/1"),
    ];

    expect(ids(interleaveByHost(jobs))).toBe("abc");
  });

  // The queue arrives grouped by collector, which puts every job from one
  // site back to back. That is the order a rate limit punishes hardest.
  test("a list grouped by host is dealt one from each in turn", () => {
    const jobs = [
      job("1", "https://a.example/1"),
      job("2", "https://a.example/2"),
      job("3", "https://a.example/3"),
      job("4", "https://b.example/1"),
      job("5", "https://b.example/2"),
      job("6", "https://c.example/1"),
    ];

    expect(ids(interleaveByHost(jobs))).toBe("146253");
  });

  test("every job comes back, none added and none lost", () => {
    const jobs = [
      job("1", "https://a.example/1"),
      job("2", "https://a.example/2"),
      job("3", "https://b.example/1"),
      job("4", null),
    ];

    const dealt = interleaveByHost(jobs);

    expect(dealt).toHaveLength(4);
    expect([...dealt].map((entry) => entry.id).sort()).toEqual(["1", "2", "3", "4"]);
  });

  // A host runs out before the others, and the deal carries on without it
  // rather than leaving a gap or stopping early.
  test("a host that runs out is skipped for the rest of the deal", () => {
    const jobs = [
      job("1", "https://a.example/1"),
      job("2", "https://a.example/2"),
      job("3", "https://a.example/3"),
      job("4", "https://b.example/1"),
    ];

    expect(ids(interleaveByHost(jobs))).toBe("1423");
  });

  // Resolution reads a job's host from its own link, so a job holding none
  // cannot be spaced out by host. It is still dealt, under its own group.
  test("a job with no link is still dealt", () => {
    const jobs = [job("1", "https://a.example/1"), job("2", null), job("3", "https://a.example/2")];

    expect(ids(interleaveByHost(jobs))).toBe("123");
  });

  test("hosts differing only by subdomain are different hosts", () => {
    const jobs = [
      job("1", "https://jobs.a.example/1"),
      job("2", "https://jobs.a.example/2"),
      job("3", "https://careers.a.example/1"),
    ];

    expect(ids(interleaveByHost(jobs))).toBe("132");
  });

  test("an empty list comes back empty", () => {
    expect(interleaveByHost([])).toEqual([]);
  });

  test("the list handed in is not reordered in place", () => {
    const jobs = [
      job("1", "https://a.example/1"),
      job("2", "https://a.example/2"),
      job("3", "https://b.example/1"),
    ];

    interleaveByHost(jobs);

    expect(ids(jobs)).toBe("123");
  });
});
