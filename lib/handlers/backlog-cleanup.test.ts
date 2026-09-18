import { describe, expect, test } from "vitest";
import { cleanBacklogJobs } from "./backlog-cleanup";
import type { JobListEntry } from "../types/job-list-entry";

// Covers what the step does to the jobs it is handed. The trace rows it
// writes keep their own coverage in backlog-cleanup-events.test.ts and are
// not re-asserted here.

const NOW = new Date("2026-09-14T12:00:00.000Z");
const THRESHOLD = 30;

function entry(id: string, overrides: JobListEntry = {}): JobListEntry {
  return {
    id,
    collector: "greenhouse",
    status: "backlog",
    collected_at: NOW,
    ...overrides,
  };
}

// AC 1 and 2. One rule decides both outcomes, so both cases run against one
// call rather than each proving the rule on its own.
describe("what the step does to a backlog job", () => {
  test("a job past the expiry threshold takes the status expired", async () => {
    const stale = entry("stale", { posting_date: new Date("2026-07-01T12:00:00.000Z") });

    const result = await cleanBacklogJobs([stale], {
      expiryThresholdDays: THRESHOLD,
      referenceInstant: NOW,
    });

    expect(result.jobs).toEqual([{ ...stale, status: "expired" }]);
  });

  test("a job inside the expiry threshold is unchanged", async () => {
    const fresh = entry("fresh", { posting_date: new Date("2026-09-10T12:00:00.000Z") });

    const result = await cleanBacklogJobs([fresh], {
      expiryThresholdDays: THRESHOLD,
      referenceInstant: NOW,
    });

    expect(result.jobs).toEqual([fresh]);
  });
});
