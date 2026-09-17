import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { ACTIVE_STATUSES, RULED_OUT_STATUSES } from "../lib/utils/job-status";
import { fakeJobService } from "../lib/services/job-service.fake";
import { fakeWorkLogService } from "../lib/services/work-log-service.fake";
import type { JobListEntry } from "../lib/types/job-list-entry";
import { readPageContents } from "./serve";

// This file lives in scripts/, so the repo root is one level up.
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");

const HELD: JobListEntry[] = [
  { id: "backlog-job", status: "backlog" },
  ...ACTIVE_STATUSES.map((status) => ({ id: `active-${status}`, status })),
  ...RULED_OUT_STATUSES.map((status) => ({ id: `ruled-out-${status}`, status })),
];

function contentsFrom(jobs: JobListEntry[] = HELD) {
  return readPageContents(fakeJobService([...jobs]), fakeWorkLogService());
}

// Criteria 113, 136 and 138. Which statuses a list covers is decided here,
// where the lists are asked for.
describe("which jobs each list holds", () => {
  test("the backlog holds only jobs at the backlog status", async () => {
    const contents = await contentsFrom();

    expect(contents.backlog.map((row) => row.job.id)).toEqual(["backlog-job"]);
  });

  test("the active list holds every applied-to status and nothing else", async () => {
    const contents = await contentsFrom();

    expect(contents.active.map((row) => row.job.status).sort()).toEqual([...ACTIVE_STATUSES].sort());
  });

  test("the ruled-out list holds every ruled-out status", async () => {
    const contents = await contentsFrom();
    const statuses = contents.disqualified.map((row) => row.job.status).sort();

    expect(statuses).toEqual([...RULED_OUT_STATUSES].sort());
  });

  test("the ruled-out list holds the jobs the pipeline could not follow or read", async () => {
    const contents = await contentsFrom();
    const statuses = contents.disqualified.map((row) => row.job.status);

    expect(statuses).toContain("unresolvable");
    expect(statuses).toContain("unparseable");
  });

  test("no job appears on two lists", async () => {
    const contents = await contentsFrom();
    const ids = [...contents.backlog, ...contents.active, ...contents.disqualified].map(
      (row) => row.job.id
    );

    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the work log", () => {
  test("every filed entry reaches the page", async () => {
    const workLog = fakeWorkLogService();
    await workLog.write({
      job_id: "backlog-job",
      company_name: "Acme",
      job_title: "Senior Product Designer",
      activity: "Applied for job",
    });

    const contents = await readPageContents(fakeJobService([...HELD]), workLog);

    expect(contents.workLog).toHaveLength(1);
    expect(contents.workLog[0].entry.job_title).toBe("Senior Product Designer");
  });
});

// Criterion 144. The three status lists are declared in one file, and the
// page reads them from there rather than naming them again.
describe("where the status lists come from", () => {
  test("the command names no status of its own", () => {
    const source = readFileSync(join(repoRoot, "scripts", "serve.ts"), "utf8");

    expect(source).toContain("ACTIVE_STATUSES");
    expect(source).toContain("RULED_OUT_STATUSES");
    expect(source).not.toContain('"app. sent"');
    expect(source).not.toContain('"unresolvable"');
  });
});

// Criterion 176. Reading a page must not enter the pipeline's counts, and the
// only way to be sure is for the command to build no trace service at all.
describe("what the dashboard records", () => {
  test("the command builds nothing that writes a trace row", () => {
    const source = readFileSync(join(repoRoot, "scripts", "serve.ts"), "utf8");

    expect(source).not.toContain("trace");
    expect(source).not.toContain("Trace");
  });
});
