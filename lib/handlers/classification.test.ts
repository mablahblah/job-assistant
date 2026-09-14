import { describe, expect, test } from "vitest";
import { classifyJobs, type ClassifyJobsOptions } from "./classification";
import type { JobListEntry } from "../types/job-list-entry";
import { fakePlaceService } from "../services/place-service.fake";
import { fakeGeocoder } from "../tools/geocoder.fake";
import type { PlaceRecord } from "../services/place-service";

// Covers what the step decides about a job. The trace rows it writes keep
// their own coverage in classification-events.test.ts and are not
// re-asserted here.

const NOW = new Date("2026-09-14T12:00:00.000Z");
const COLLECTED = new Date("2026-09-14T12:00:00.000Z");
const HOME = { latitude: 30.2672, longitude: -97.7431 };
const RADIUS_MILES = 30;
const EXPIRY_THRESHOLD = 30;
const REPOST_GAP = 3;

const FRESH = new Date("2026-09-12T12:00:00.000Z");
const STALE = new Date("2026-07-01T12:00:00.000Z");

// Austin sits inside the radius. Philadelphia is far outside it.
const AUSTIN: PlaceRecord = {
  lookup_text: "Austin",
  latitude: 30.2672,
  longitude: -97.7431,
  place_type: "city",
  display_name: "Austin, Texas",
  outline: null,
};

const PHILADELPHIA: PlaceRecord = {
  lookup_text: "Philadelphia",
  latitude: 39.9526,
  longitude: -75.1652,
  place_type: "city",
  display_name: "Philadelphia, Pennsylvania",
  outline: null,
};

// The list classification is handed comes from findUnclassified, which leaves
// the status and the three phase gates off every row.
function entry(id: string, overrides: JobListEntry = {}): JobListEntry {
  return {
    id,
    collector: "greenhouse",
    collected_at: COLLECTED,
    posting_date: FRESH,
    normalized_location_list: ["Austin"],
    normalized_mode_list: ["remote"],
    ...overrides,
  };
}

function options(overrides: Partial<ClassifyJobsOptions> = {}): ClassifyJobsOptions {
  return {
    repostGapDays: REPOST_GAP,
    expiryThresholdDays: EXPIRY_THRESHOLD,
    referenceInstant: NOW,
    home: HOME,
    radiusMiles: RADIUS_MILES,
    places: fakePlaceService([AUSTIN, PHILADELPHIA]),
    geocoder: fakeGeocoder(),
    ...overrides,
  };
}

async function classifyOne(job: JobListEntry, overrides: Partial<ClassifyJobsOptions> = {}) {
  const result = await classifyJobs([job], options(overrides));
  return result.jobs[0];
}

// AC 20 to 23. Two posting dates further apart than the gap read as the
// employer listing the role again, rather than as two collectors disagreeing
// by hours about one posting.
describe("the repost check", () => {
  test("dates wider apart than the gap mark a repost", async () => {
    const job = await classifyOne(
      entry("relisted", {
        posting_date: new Date("2026-09-01T12:00:00.000Z"),
        posting_updated_date: new Date("2026-09-12T12:00:00.000Z"),
      })
    );

    expect(job.is_repost).toBe(true);
  });

  test("dates inside the gap mark no repost", async () => {
    const job = await classifyOne(
      entry("same-posting", {
        posting_date: new Date("2026-09-12T06:00:00.000Z"),
        posting_updated_date: new Date("2026-09-12T18:00:00.000Z"),
      })
    );

    expect(job.is_repost).toBe(false);
  });

  test("one posting date alone marks no repost", async () => {
    const job = await classifyOne(entry("one-date", { posting_updated_date: null }));

    expect(job.is_repost).toBe(false);
  });

  // The gap is an exact duration rather than a count of calendar days,
  // because absorbing a disagreement of hours is the whole point of it.
  test("hours past a whole number of days count toward the gap", async () => {
    const job = await classifyOne(
      entry("just-over", {
        posting_date: new Date("2026-09-08T00:00:00.000Z"),
        posting_updated_date: new Date("2026-09-11T06:00:00.000Z"),
      })
    );

    expect(job.is_repost).toBe(true);
  });
});

// AC 25 to 27. A job too old to apply to is marked expired and judged no
// further, so no time is spent working out where it sits.
describe("the age check", () => {
  test("a job past the expiry threshold takes the status expired", async () => {
    const job = await classifyOne(entry("stale", { posting_date: STALE }));

    expect(job.status).toBe("expired");
  });

  test("a job past the expiry threshold is marked as judged", async () => {
    const job = await classifyOne(entry("stale", { posting_date: STALE }));

    expect(job.is_classified).toBe(true);
  });

  test("no place is looked up for a job past the expiry threshold", async () => {
    const geocoder = fakeGeocoder();

    await classifyOne(entry("stale", { posting_date: STALE, normalized_location_list: ["Berlin"] }), {
      geocoder,
      places: fakePlaceService(),
    });

    expect(geocoder.lookedUp).toEqual([]);
  });

  // AC 112 and 113. A job can be both, and the repost mark is not lost to
  // the expiry that follows it.
  test("a job that is both a repost and too old is marked as both", async () => {
    const job = await classifyOne(
      entry("both", {
        posting_date: new Date("2026-06-01T12:00:00.000Z"),
        posting_updated_date: STALE,
      })
    );

    expect([job.is_repost, job.status]).toEqual([true, "expired"]);
  });
});

// AC 28 to 31 and 35. Everything inside the threshold is matched, and the
// answer is written down with the place and mode that produced it.
describe("the location match", () => {
  test("a job close enough records the place and mode that matched", async () => {
    const job = await classifyOne(entry("near"));

    expect([job.location_match, job.location_match_place, job.location_match_mode]).toEqual([
      true,
      "Austin",
      "remote",
    ]);
  });

  test("a job close enough keeps its status and is marked as judged", async () => {
    const job = await classifyOne(entry("near"));

    expect([job.status, job.is_classified]).toEqual([undefined, true]);
  });

  test("a job matching no pair takes the status too far", async () => {
    const job = await classifyOne(entry("far", { normalized_location_list: ["Philadelphia"] }));

    expect([job.status, job.location_match, job.is_classified]).toEqual(["too far", false, true]);
  });

  // AC 35. One place resolving is enough to reach a verdict, even where the
  // verdict is that the job is too far away.
  test("a job whose one readable place is far away is too far", async () => {
    const job = await classifyOne(
      entry("mixed", { normalized_location_list: ["Bad Robot Games", "Philadelphia"] })
    );

    expect(job.status).toBe("too far");
  });
});

// AC 32 to 34. A place we could not read is not proof a job is far away, so
// the job stays in the backlog for a later run to retry.
describe("a job whose every place is unreadable", () => {
  test("its status is unchanged", async () => {
    const job = await classifyOne(entry("unreadable", { normalized_location_list: ["Bad Robot"] }));

    expect(job.status).toBeUndefined();
  });

  test("it is not marked as judged", async () => {
    const job = await classifyOne(entry("unreadable", { normalized_location_list: ["Bad Robot"] }));

    expect(job.is_classified).toBeFalsy();
  });

  test("its match answer is left empty", async () => {
    const job = await classifyOne(entry("unreadable", { normalized_location_list: ["Bad Robot"] }));

    expect(job.location_match ?? null).toBeNull();
  });
});

// AC 62. A job naming no place at all is still judged, on its work mode
// alone, so a posting that says only "remote" is not turned down for naming
// nowhere.
describe("a job naming no place", () => {
  test("a remote job matches", async () => {
    const job = await classifyOne(entry("remote-only", { normalized_location_list: [] }));

    expect([job.location_match, job.location_match_mode]).toEqual([true, "remote"]);
  });

  test("an in-person job is too far", async () => {
    const job = await classifyOne(
      entry("onsite-nowhere", { normalized_location_list: [], normalized_mode_list: ["in-person"] })
    );

    expect(job.status).toBe("too far");
  });
});

// AC 71 to 74. A place is looked up once and reused, because a run should
// only pay for places it has never seen.
describe("what the step asks the mapping service", () => {
  test("a place already held is never requested", async () => {
    const geocoder = fakeGeocoder();

    await classifyOne(entry("held"), { geocoder });

    expect(geocoder.lookedUp).toEqual([]);
  });

  test("a place not held is requested once and then stored", async () => {
    const geocoder = fakeGeocoder({
      Dallas: {
        latitude: 32.7767,
        longitude: -96.797,
        place_type: "city",
        display_name: "Dallas, Texas",
        outline: null,
      },
    });
    const places = fakePlaceService();

    await classifyJobs(
      [
        entry("one", { normalized_location_list: ["Dallas"] }),
        entry("two", { normalized_location_list: ["Dallas"] }),
      ],
      options({ geocoder, places })
    );

    expect(geocoder.lookedUp).toEqual(["Dallas"]);
    expect(await places.findByText("Dallas")).not.toBeNull();
  });

  // AC 74. A place that resolved to nothing is not stored, so it is tried
  // again next run — but not a second time within this one.
  test("a place that resolved to nothing is requested once in a run", async () => {
    const geocoder = fakeGeocoder();

    await classifyJobs(
      [
        entry("one", { normalized_location_list: ["Bad Robot"] }),
        entry("two", { normalized_location_list: ["Bad Robot"] }),
      ],
      options({ geocoder, places: fakePlaceService() })
    );

    expect(geocoder.lookedUp).toEqual(["Bad Robot"]);
  });
});

// AC 36. One job's lookup failing costs that one job rather than the rest of
// the list.
describe("a lookup that throws", () => {
  test("the jobs after it are still judged", async () => {
    const geocoder = fakeGeocoder({ Berlin: new Error("the mapping service refused") });

    const result = await classifyJobs(
      [
        entry("throws", { normalized_location_list: ["Berlin"] }),
        entry("after", { normalized_location_list: ["Austin"] }),
      ],
      options({ geocoder })
    );

    expect(result.jobs[1].location_match).toBe(true);
  });

  test("the job it threw on stays unjudged in the backlog", async () => {
    const geocoder = fakeGeocoder({ Berlin: new Error("the mapping service refused") });

    const result = await classifyJobs(
      [entry("throws", { normalized_location_list: ["Berlin"] })],
      options({ geocoder })
    );

    expect([result.jobs[0].status, result.jobs[0].is_classified]).toEqual([undefined, undefined]);
  });
});
