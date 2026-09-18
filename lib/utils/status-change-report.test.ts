import { describe, expect, test } from "vitest";
import { statusChangeReport } from "./status-change-report";
import type { ChangedJob } from "../types/changed-job";
import type { EnrichedCompany } from "../types/enriched-company";

function changed(fields: Partial<ChangedJob> = {}): ChangedJob {
  return {
    job_id: "job-a",
    status: "app. sent",
    outcome: "changed",
    entry_written: true,
    company_id: "co-1",
    company_name: "Figma",
    place: null,
    ...fields,
  };
}

function searched(fields: Partial<EnrichedCompany> = {}): EnrichedCompany {
  return {
    company_id: "co-1",
    company_name: "Figma",
    outcome: "filled",
    doubts: [],
    ...fields,
  };
}

// Criterion 10. There is no page in this phase, so this report is the only
// place the user learns that a legal record exists.
describe("one line per job", () => {
  test("a submission of three jobs prints three lines", async () => {
    const lines = statusChangeReport({
      changes: [changed({ job_id: "job-a" }), changed({ job_id: "job-b" }), changed({ job_id: "job-c" })],
      companies: [],
    });

    expect(lines.filter((line) => line.includes("job-"))).toHaveLength(3);
  });

  test("every job named in the submission appears", async () => {
    const lines = statusChangeReport({
      changes: [changed({ job_id: "job-a" }), changed({ job_id: "ghost", outcome: "no_such_job" })],
      companies: [],
    }).join("\n");

    expect(lines).toContain("job-a");
    expect(lines).toContain("ghost");
  });
});

// Criteria 11 and 12.
describe("what each line says about the work log entry", () => {
  test("a job that got an entry says so", async () => {
    const lines = statusChangeReport({ changes: [changed()], companies: [] }).join("\n");

    expect(lines).toContain("work log entry written");
  });

  test("a job that got no entry says so", async () => {
    const lines = statusChangeReport({
      changes: [changed({ status: "rejected", entry_written: false })],
      companies: [],
    }).join("\n");

    expect(lines).toContain("no work log entry");
  });
});

// Criterion 14, and the two phrases the skill scans for. It has to tell "this
// job needs an employer name" from "no job holds that id" in order to know
// whether to ask the user.
describe("the phrases the skill reads", () => {
  test("a job needing an employer name is named with a fixed phrase", async () => {
    const lines = statusChangeReport({
      changes: [changed({ outcome: "needs_company_name", entry_written: false, company_id: null, company_name: null })],
      companies: [],
    }).join("\n");

    expect(lines).toContain("needs an employer name");
  });

  test("a job no row holds is named with a different fixed phrase", async () => {
    const lines = statusChangeReport({
      changes: [changed({ job_id: "ghost", outcome: "no_such_job", entry_written: false })],
      companies: [],
    }).join("\n");

    expect(lines).toContain("no job holds that id");
  });

  test("the two phrases never appear on the same line", async () => {
    const lines = statusChangeReport({
      changes: [
        changed({ job_id: "ghost", outcome: "no_such_job", entry_written: false }),
        changed({ job_id: "job-b", outcome: "needs_company_name", entry_written: false }),
      ],
      companies: [],
    });

    for (const line of lines) {
      const both = line.includes("needs an employer name") && line.includes("no job holds that id");
      expect(both).toBe(false);
    }
  });

  test("a job that was not changed says it was not changed", async () => {
    const lines = statusChangeReport({
      changes: [changed({ outcome: "needs_company_name", entry_written: false })],
      companies: [],
    }).join("\n");

    expect(lines).toContain("not changed");
  });
});

// Criterion 13.
describe("what the report says about the search", () => {
  test("an employer whose search filled something in says so", async () => {
    const lines = statusChangeReport({
      changes: [changed()],
      companies: [searched()],
    }).join("\n");

    expect(lines).toContain("Figma");
    expect(lines).toContain("contact details filled in");
  });

  // Criterion 57.
  test("an employer whose search found nothing says so", async () => {
    const lines = statusChangeReport({
      changes: [changed()],
      companies: [searched({ outcome: "found_nothing" })],
    }).join("\n");

    expect(lines).toContain("found nothing");
  });

  // Criterion 56.
  test("an employer with no search credential says no search was made", async () => {
    const lines = statusChangeReport({
      changes: [changed()],
      companies: [searched({ outcome: "no_credential" })],
    }).join("\n");

    expect(lines).toContain("no search was made");
  });

  test("an employer already filled in says so", async () => {
    const lines = statusChangeReport({
      changes: [changed()],
      companies: [searched({ outcome: "already_filled" })],
    }).join("\n");

    expect(lines).toContain("already filled in");
  });

  test("the doubts a search raised are named", async () => {
    const lines = statusChangeReport({
      changes: [changed()],
      companies: [searched({ doubts: ["address_outside_us", "missing_phone"] })],
    }).join("\n");

    expect(lines).toContain("address_outside_us");
    expect(lines).toContain("missing_phone");
  });

  test("a run that searched nobody says nothing about searches", async () => {
    const lines = statusChangeReport({
      changes: [changed({ status: "rejected", entry_written: false })],
      companies: [],
    }).join("\n");

    expect(lines).not.toContain("contact details");
  });
});

// Criterion 69. The report is built from what the handlers returned, because
// this phase writes no trace rows for it to count.
describe("a failed work log entry", () => {
  test("is reported as not written", async () => {
    const lines = statusChangeReport({
      changes: [changed({ outcome: "entry_failed", entry_written: false })],
      companies: [],
    }).join("\n");

    expect(lines).toContain("no work log entry");
  });
});

describe("a job whose title was empty", () => {
  test("is reported as having got no entry", async () => {
    const lines = statusChangeReport({
      changes: [changed({ outcome: "no_title", entry_written: false })],
      companies: [],
    }).join("\n");

    expect(lines).toContain("no work log entry");
  });
});

describe("a run that changed nothing", () => {
  test("says so rather than printing an empty report", async () => {
    const lines = statusChangeReport({ changes: [], companies: [] }).join("\n");

    expect(lines).toContain("No job was named");
  });
});
