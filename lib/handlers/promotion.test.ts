import { describe, expect, test } from "vitest";
import { promoteJobs } from "./promotion";
import type { JobListEntry } from "../types/job-list-entry";

// Covers what the step does to the jobs it is handed. The trace rows it
// writes keep their own coverage in promotion-events.test.ts and are not
// re-asserted here.

const COLLECTED = new Date("2026-09-14T12:00:00.000Z");

// The list promotion is handed comes from findExpiredWithin, which leaves the
// status and the three phase gates off every row, so an entry here carries
// neither.
function entry(id: string, overrides: JobListEntry = {}): JobListEntry {
  return { id, collector: "greenhouse", collected_at: COLLECTED, ...overrides };
}

// AC 11 and 12. A job an employer listed again returns to the backlog, and
// comes back unjudged so classification reaches its own conclusion rather
// than the one that expired it.
describe("what the step does to an expired job", () => {
  test("it returns to the backlog", async () => {
    const result = await promoteJobs([entry("relisted")], {});

    expect(result.jobs[0].status).toBe("backlog");
  });

  test("it is marked as not yet judged", async () => {
    const result = await promoteJobs([entry("relisted")], {});

    expect(result.jobs[0].is_classified).toBe(false);
  });

  // AC 13. Clearing the old location answer buys nothing, because
  // classification overwrites it moments later.
  test("its place, work mode, match answer and repost mark are unchanged", async () => {
    const judged = entry("relisted", {
      location_match: true,
      location_match_place: "Austin",
      location_match_mode: "remote",
      is_repost: true,
    });

    const result = await promoteJobs([judged], {});

    expect(result.jobs[0]).toEqual({ ...judged, status: "backlog", is_classified: false });
  });
});
