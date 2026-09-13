import { describe, expect, test } from "vitest";
import { normalizeJob, type NormalizationEvent } from "./normalization";
import type { JobListEntry } from "../types/job-list-entry";
import type { TitleVocabularies } from "../utils/title";

// Covers only the events array normalizeJob returns alongside the job. The
// job itself keeps its own coverage in normalizer.test.ts and is not
// re-asserted here.

// The measured defaults from scripts/db-seed.ts's SETTING_DEFAULTS, restated
// so title routing runs against what really ships. It moves whenever
// SETTING_DEFAULTS does, as do the copies in lib/handlers/normalization.test.ts,
// lib/handlers/normalization-handler.test.ts and lib/utils/title.test.ts.
const VOCABULARIES: TitleVocabularies = {
  headNouns: [
    "analyst", "architect", "artist", "consultant", "coordinator", "copywriter",
    "designer", "developer", "director", "engineer", "head", "lead", "manager",
    "owner", "producer", "programmer", "researcher", "scientist", "specialist",
    "strategist", "technician", "technologist", "translator", "vp", "writer",
  ],
  levels: [
    { store: "Intern", match: ["intern"] },
    { store: "Entry-Level", match: ["entry level", "entry-level"] },
    { store: "Jr.", match: ["junior", "jr", "jr."] },
    { store: "Associate", match: ["associate", "assoc"] },
    { store: "Mid-Level", match: ["mid level", "mid-level", "mid"] },
    { store: "Sr.", match: ["senior", "sr", "sr."] },
    { store: "Staff", match: ["staff"] },
    { store: "Lead", match: ["lead"] },
    { store: "Principal", match: ["principal"] },
    { store: "Head", match: ["head"] },
    { store: "Director", match: ["director"] },
    { store: "VP", match: ["vp"] },
    { store: "Chief", match: ["chief"] },
  ],
  suffixes: ["-er", "-or", "-ist", "-yst", "-ian", "-ant", "-ect"],
  removalWords: ["w2", "c2h", "evergreen"],
};

// Pulls one event out of the array by its reason, so a test reads as an
// assertion on that event rather than an index into the array. Throws with
// the reasons that were actually written, so a failure says what happened
// instead of just "undefined".
function eventFor(result: ReturnType<typeof normalizeJob>, reason: string): NormalizationEvent {
  const event = result.events.find((candidate) => candidate.reason === reason);
  if (!event) {
    const seen = result.events.map((candidate) => candidate.reason).join(", ") || "(none)";
    throw new Error(`no event with reason "${reason}" among: ${seen}`);
  }
  return event;
}

// One input per reason, built from the already-passing tests of the four
// normalizers. Shared by the two blocks below, which check a different thing
// about the same nine cases.
const REASON_CASES: Array<
  [reason: string, expectedEvent: NormalizationEvent["event"], job: JobListEntry]
> = [
  ["title_normalized", "job_updated", { raw_title: "Senior UX Designer" }],
  ["title_not_normalized", "normalization_failed", { raw_title: "UI/UX" }],
  ["salary_normalized", "job_updated", { raw_salary: { salary_min: 85000, salary_max: 115000 } }],
  [
    "salary_partially_normalized",
    "job_updated",
    { raw_salary: { salary_min: 85000, salary_period: "fortnight" } },
  ],
  [
    "salary_unusable",
    "normalization_failed",
    { raw_salary: { salary_period: "YEAR", salary_currency: "USD" } },
  ],
  ["work_mode_normalized", "job_updated", { raw_mode_list: ["Remote"] }],
  ["work_mode_partially_normalized", "job_updated", { raw_mode_list: ["Remote", "flexible"] }],
  ["work_mode_unusable", "normalization_failed", { raw_mode_list: ["flexible"] }],
  ["company_name_normalized", "job_updated", { raw_company_name: "Meta Platforms, Inc. " }],
];

describe("normalizeJob: which reason fires", () => {
  test.each(REASON_CASES)("%s fires as a %s event", (reason, expectedEvent, job) => {
    expect(eventFor(normalizeJob(job, VOCABULARIES), reason).event).toBe(expectedEvent);
  });
});

describe("normalizeJob: every event carries a before-and-after detail", () => {
  test.each(REASON_CASES)("%s carries a non-empty from and to", (reason, _expectedEvent, job) => {
    const event = eventFor(normalizeJob(job, VOCABULARIES), reason);
    expect(event.detail.from.length).toBeGreaterThan(0);
    expect(event.detail.to.length).toBeGreaterThan(0);
  });
});

describe("normalizeJob: an envelope with nothing countable in it", () => {
  test("a raw_salary holding only a currency reads as unusable", () => {
    // The currency has no column to land in, so nothing countable is present
    // and nothing comes out. Checking "none normalized" before "all
    // normalized" is what stops a count of zero out of zero passing as a
    // success.
    const job: JobListEntry = { raw_salary: { salary_currency: "USD" } };
    const event = eventFor(normalizeJob(job, VOCABULARIES), "salary_unusable");
    expect(event.event).toBe("normalization_failed");
  });
});

describe("normalizeJob: title event detail", () => {
  test("a matched title's detail holds the raw title and the normalized title", () => {
    const job: JobListEntry = { raw_title: "Senior UX Designer" };
    const event = eventFor(normalizeJob(job, VOCABULARIES), "title_normalized");
    expect(event.detail.from).toBe("Senior UX Designer");
    expect(event.detail.to).toBe("Sr. UX Designer");
  });

  test("a fallback title's detail holds the raw title and the tidied fallback string", () => {
    // Brackets come out during tidying, so from and to differ here even
    // though no job noun is found and the title still counts as unmatched.
    const job: JobListEntry = { raw_title: "(UI/UX)" };
    const event = eventFor(normalizeJob(job, VOCABULARIES), "title_not_normalized");
    expect(event.detail.from).toBe("(UI/UX)");
    expect(event.detail.to).toBe("UI/UX");
  });
});

describe("normalizeJob: salary event detail", () => {
  test("a cents envelope's detail names the raw figure and the divided one", () => {
    const job: JobListEntry = { raw_salary: { salary_min: 140000, salary_unit: "cents" } };
    const event = eventFor(normalizeJob(job, VOCABULARIES), "salary_normalized");
    expect(event.detail.from).toContain("140000");
    expect(event.detail.to).toContain("1400");
  });
});

describe("normalizeJob: work mode event detail", () => {
  test("from holds the raw entries and to holds only the ones that mapped", () => {
    const job: JobListEntry = { raw_mode_list: ["Remote", "flexible"] };
    const event = eventFor(normalizeJob(job, VOCABULARIES), "work_mode_partially_normalized");
    expect(event.detail.from).toContain("Remote");
    expect(event.detail.from).toContain("flexible");
    expect(event.detail.to).toContain("remote");
    expect(event.detail.to).not.toContain("flexible");
  });
});

describe("normalizeJob: company name event detail", () => {
  test("from holds the spelling the source published, not the cleaned one", () => {
    // The cleaned name overwrites raw_company_name in place, so this event is
    // the only surviving record of what the source actually sent.
    const job: JobListEntry = { raw_company_name: "Meta Platforms, Inc. " };
    const event = eventFor(normalizeJob(job, VOCABULARIES), "company_name_normalized");
    expect(event.detail.from).toBe("Meta Platforms, Inc. ");
    expect(event.detail.to).toBe("Meta Platforms, Inc");
  });
});

describe("normalizeJob: how many events get written", () => {
  test("a job with all four raw fields present produces four events", () => {
    const job: JobListEntry = {
      raw_title: "Senior UX Designer",
      raw_salary: { salary_min: 85000, salary_max: 115000 },
      raw_mode_list: ["Remote"],
      raw_company_name: "Meta Platforms, Inc. ",
    };
    const { events } = normalizeJob(job, VOCABULARIES);
    expect(events).toHaveLength(4);
    expect(events.map((event) => event.reason).sort()).toEqual(
      [
        "company_name_normalized",
        "salary_normalized",
        "title_normalized",
        "work_mode_normalized",
      ].sort()
    );
  });

  test("a job with no raw fields at all produces no events", () => {
    const job: JobListEntry = { id: "job-1", status: "backlog" };
    expect(normalizeJob(job, VOCABULARIES).events).toEqual([]);
  });

  test.each<[string, JobListEntry]>([
    ["an empty raw_mode_list", { raw_mode_list: [] }],
    ["an empty raw_salary", { raw_salary: {} }],
  ])("%s writes no event, the same as if the field were absent", (_label, job) => {
    expect(normalizeJob(job, VOCABULARIES).events).toEqual([]);
  });
});

describe("normalizeJob: detail values are truncated", () => {
  test("a 500-character raw_title gives a detail.from of exactly 200 characters", () => {
    // Guards the trace table against a collector bug that puts a whole job
    // description into raw_title. The longest real title measured is 131.
    const job: JobListEntry = { raw_title: "A".repeat(500) };
    const event = eventFor(normalizeJob(job, VOCABULARIES), "title_not_normalized");
    expect(event.detail.from).toHaveLength(200);
  });
});
