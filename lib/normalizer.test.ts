import { describe, expect, test } from "vitest";
import { normalizeJob } from "./normalizer";
import type { JobListEntry } from "./job-list-entry";
import type { TitleVocabularies } from "./title";

// The measured defaults from scripts/db-seed.ts's SETTING_DEFAULTS, restated
// so normalizeJob's title routing runs against what really ships. It moves
// whenever SETTING_DEFAULTS does, as do the copies in lib/title.test.ts and
// EXPECTED_TITLE_LEVELS in lib/settings-service.test.ts.
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

describe("normalizeJob: title", () => {
  test("raw_title is run through normalizeTitle and the result lands on title", () => {
    const job: JobListEntry = { raw_title: "Senior UX Designer" };
    expect(normalizeJob(job, VOCABULARIES).title).toBe("Sr. UX Designer");
  });

  test.each([
    ["missing", undefined],
    ["null", null],
    ["an empty string", ""],
  ])("raw_title that is %s leaves title untouched", (_label, rawTitle) => {
    // normalizeTitle("") answers with an empty title rather than refusing, so
    // a service that called it regardless would wipe a title an earlier pass
    // had already written. Going looking for a missing title is parsing, a
    // later phase.
    const job: JobListEntry = { raw_title: rawTitle, title: "Existing Title" };
    expect(normalizeJob(job, VOCABULARIES).title).toBe("Existing Title");
  });
});

describe("normalizeJob: salary", () => {
  test("raw_salary is run through normalizeSalary onto the three salary columns", () => {
    const job: JobListEntry = { raw_salary: { salary_min: 85000, salary_max: 115000 } };
    const result = normalizeJob(job, VOCABULARIES);
    expect(result.salary_low).toBe(85000);
    expect(result.salary_high).toBe(115000);
    expect(result.salary_period).toBe("year");
  });

  test("a cents envelope is divided down before it reaches salary_low", () => {
    // Proves the whole envelope is handed over, not just the two figures.
    const job: JobListEntry = { raw_salary: { salary_min: 140000, salary_unit: "cents" } };
    expect(normalizeJob(job, VOCABULARIES).salary_low).toBe(1400);
  });

  test("a stale salary_low is replaced rather than kept when raw_salary is present", () => {
    // Every field is worked out again from its raw source on every pass, with
    // nothing asking whether the answer is already filled in. Without that, a
    // second pass could never correct a wrong figure.
    const job: JobListEntry = {
      raw_salary: { salary_min: 60000, salary_max: 90000 },
      salary_low: 999,
      salary_high: 111,
      salary_period: "month",
    };
    const result = normalizeJob(job, VOCABULARIES);
    expect(result.salary_low).toBe(60000);
    expect(result.salary_high).toBe(90000);
    expect(result.salary_period).toBe("year");
  });

  test("an envelope enriched between passes shows up on the next pass", () => {
    // Parsing can add a figure collection never had, and the pass after it
    // has to pick that up.
    const firstPass = normalizeJob({ raw_salary: { salary_min: 70000 } }, VOCABULARIES);
    expect(firstPass.salary_high).toBeUndefined();

    const secondPass = normalizeJob(
      { ...firstPass, raw_salary: { salary_min: 70000, salary_max: 95000 } },
      VOCABULARIES
    );
    expect(secondPass.salary_low).toBe(70000);
    expect(secondPass.salary_high).toBe(95000);
  });

  test.each([
    ["missing", undefined],
    ["null", null],
    ["an empty object", {}],
  ])("raw_salary that is %s leaves the salary columns untouched", (_label, rawSalary) => {
    // A Json column read back from the database comes through as null, not
    // undefined, so both have to read as absent.
    const job: JobListEntry = {
      raw_salary: rawSalary,
      salary_low: 900,
      salary_high: 950,
      salary_period: "hour",
    };
    const result = normalizeJob(job, VOCABULARIES);
    expect(result.salary_low).toBe(900);
    expect(result.salary_high).toBe(950);
    expect(result.salary_period).toBe("hour");
  });
});

describe("normalizeJob: work mode list", () => {
  test("raw_mode_list is run through normalizeModeList onto normalized_mode_list", () => {
    const job: JobListEntry = { raw_mode_list: ["Remote", "remote", "flexible"] };
    expect(normalizeJob(job, VOCABULARIES).normalized_mode_list).toEqual(["remote"]);
  });

  test.each([
    ["missing", undefined],
    ["null", null],
    ["an empty list", []],
  ])("raw_mode_list that is %s leaves normalized_mode_list untouched", (_label, rawModeList) => {
    const job: JobListEntry = {
      raw_mode_list: rawModeList,
      normalized_mode_list: ["hybrid"],
    };
    expect(normalizeJob(job, VOCABULARIES).normalized_mode_list).toEqual(["hybrid"]);
  });
});

describe("normalizeJob: company name", () => {
  test("raw_company_name is cleaned in place, overwriting itself", () => {
    // There is no second column — the cleaned spelling replaces the source's
    // spelling in the same field.
    const job: JobListEntry = { raw_company_name: "Meta Platforms, Inc. " };
    expect(normalizeJob(job, VOCABULARIES).raw_company_name).toBe("Meta Platforms, Inc");
  });

  test.each([
    ["missing", undefined],
    ["null", null],
    ["an empty string", ""],
  ])("raw_company_name that is %s changes nothing", (_label, rawCompanyName) => {
    const job: JobListEntry = { raw_company_name: rawCompanyName };
    expect(normalizeJob(job, VOCABULARIES).raw_company_name).toBe(rawCompanyName);
  });
});

describe("normalizeJob: the job passed in is left alone", () => {
  test("the input job's fields are unchanged after the call", () => {
    const job: JobListEntry = {
      raw_title: "Senior UX Designer",
      raw_salary: { salary_min: 85000, salary_max: 115000 },
      raw_mode_list: ["Remote"],
      raw_company_name: "Meta Platforms, Inc. ",
    };
    const before = structuredClone(job);
    normalizeJob(job, VOCABULARIES);
    expect(job).toEqual(before);
  });

  test("the returned job is a different object from the one passed in", () => {
    const job: JobListEntry = { raw_title: "Senior UX Designer" };
    expect(normalizeJob(job, VOCABULARIES)).not.toBe(job);
  });

  test("a field none of the four normalizers reads passes straight through", () => {
    const job: JobListEntry = {
      id: "job-1",
      status: "backlog",
      original_url: "https://example.com/job",
    };
    const result = normalizeJob(job, VOCABULARIES);
    expect(result.id).toBe("job-1");
    expect(result.status).toBe("backlog");
    expect(result.original_url).toBe("https://example.com/job");
  });
});

describe("normalizeJob: running it twice over unchanged raw fields", () => {
  test("every final field is identical the second time", () => {
    const job: JobListEntry = {
      raw_title: "Senior UX Designer",
      raw_salary: { salary_min: 85000, salary_max: 115000 },
      raw_mode_list: ["Remote", "remote", "flexible"],
      raw_company_name: "Meta Platforms, Inc. ",
    };
    const first = normalizeJob(job, VOCABULARIES);
    const second = normalizeJob(first, VOCABULARIES);
    expect(second).toEqual(first);
  });
});

describe("normalizeJob: vocabularies arrive as a plain object", () => {
  test("a hand-built vocabulary is enough, with no database in sight", () => {
    const vocabularies: TitleVocabularies = {
      headNouns: ["designer"],
      levels: [{ store: "Sr.", match: ["senior"] }],
      suffixes: [],
      removalWords: [],
    };
    const job: JobListEntry = { raw_title: "Senior Designer" };
    expect(normalizeJob(job, vocabularies).title).toBe("Sr. Designer");
  });
});
