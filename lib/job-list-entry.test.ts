import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createClient } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  DEDUPE_REASONS,
  DELETE_ON_SAVE_REASONS,
  JOB_LIST_ENTRY_FIELDS,
  type JobListEntry,
} from "./job-list-entry";

// This file lives in lib/, so the repo root is one level up.
const libDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(libDir, "..");

// Creating a scratch database measured well under two seconds. This is a
// ceiling rather than a budget.
const CREATE_TIMEOUT_MS = 45_000;

// The one field a job list entry carries that is not a Job column.
const DELETE_ON_SAVE = "delete_on_save";

// An absolute url, because a relative Prisma url resolves from the directory
// holding prisma.config.ts rather than from the working directory.
function makeTempDb(prefix: string): { dir: string; url: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, url: `file:${join(dir, "pipeline.db")}` };
}

// Runs a real script against a scratch database. The url travels in the
// environment because dotenv never overwrites a variable that is already set,
// so this value wins over the repo's .env and the real pipeline.db is never
// touched.
function runScript(script: string, url: string): void {
  execFileSync("npx", ["tsx", `scripts/${script}`], {
    cwd: repoRoot,
    env: { ...process.env, PIPELINE_DATABASE_URL: url },
    stdio: "pipe",
  });
}

// Asks sqlite itself for the Job table's columns rather than trusting a list
// kept here, so a column added to the schema and left off the type fails this
// file instead of passing silently. A relation such as `company` never
// appears, because PRAGMA table_info lists only real columns.
async function readJobColumns(url: string): Promise<string[]> {
  const client = createClient({ url });
  try {
    const result = await client.execute("PRAGMA table_info(Job)");
    return result.rows.map((row) => String((row as unknown as Record<string, unknown>)["name"]));
  } finally {
    client.close();
  }
}

// Every name in `left` that is absent from `right`, sorted so a failure names
// the offending field whatever order either list came in.
function missingFrom(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((item) => !rightSet.has(item)).sort();
}

describe("AC 26: a job list entry's fields map one to one onto the Job row", () => {
  let dir: string;
  let jobColumns: string[];

  beforeAll(async () => {
    const temp = makeTempDb("pipeline-job-list-entry-");
    dir = temp.dir;
    runScript("db-create.ts", temp.url);
    jobColumns = await readJobColumns(temp.url);
  }, CREATE_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("every Job column has a same-named field on the entry", () => {
    expect(missingFrom(jobColumns, [...JOB_LIST_ENTRY_FIELDS])).toEqual([]);
  });

  test("every entry field besides delete_on_save is a real Job column", () => {
    const columnFields = JOB_LIST_ENTRY_FIELDS.filter((field) => field !== DELETE_ON_SAVE);
    expect(missingFrom([...columnFields], jobColumns)).toEqual([]);
  });

  test("delete_on_save is not a Job column, because it never reaches the database", () => {
    expect(jobColumns).not.toContain(DELETE_ON_SAVE);
  });

  test("the field count is the column count plus one for delete_on_save", () => {
    // The relationship rather than the numbers, because the schema grows a
    // phase at a time and a hardcoded count would have to be edited each time
    // without catching anything the missing-field test above does not.
    expect(JOB_LIST_ENTRY_FIELDS.length).toBe(jobColumns.length + 1);
  });

  test("no field is named twice", () => {
    expect(new Set(JOB_LIST_ENTRY_FIELDS).size).toBe(JOB_LIST_ENTRY_FIELDS.length);
  });
});

describe("AC 55: an entry marked away carries the reason it lost", () => {
  test("the three reasons that mark an entry away are the ones dedupe can set", () => {
    // matched_list_entry is dedupe's fourth reason and is deliberately absent:
    // it sits on a stored row joining the list, never on an entry leaving it.
    expect([...DEDUPE_REASONS]).toEqual([
      "hard_match_in_list",
      "repost_match_in_list",
      "matched_db_row",
    ]);
  });

  test("a marked entry reads back the reason rather than a plain true", () => {
    for (const reason of DEDUPE_REASONS) {
      const entry: JobListEntry = { id: "job-1", delete_on_save: reason };

      expect(entry.delete_on_save).toBe(reason);
      // A boolean here would leave save deleting a row while the trace row it
      // writes has no reason to name.
      expect(typeof entry.delete_on_save).toBe("string");
    }
  });

  test("every reason is truthy, so save still sees a marked entry as marked", () => {
    // lib/handlers/save.ts reads `if (entry.delete_on_save)`, so a reason that
    // was ever an empty string would silently keep the row.
    for (const reason of DEDUPE_REASONS) {
      expect(Boolean(reason)).toBe(true);
    }
  });
});

describe("AC 60: delete_on_save admits a resolution reason as well as dedupe's", () => {
  test("the reasons the field admits are dedupe's three plus blacklisted_url", () => {
    // DEDUPE_REASONS stays the narrower list of what dedupe itself may set.
    // This is the wider one the field accepts, which resolution adds to when a
    // resolution reaches a blacklisted host and the row has to go.
    expect([...DELETE_ON_SAVE_REASONS]).toEqual([...DEDUPE_REASONS, "blacklisted_url"]);

    // Assigning each one is what puts the widened type under tsc, which is the
    // only gate that reads it — vitest does not typecheck.
    for (const reason of DELETE_ON_SAVE_REASONS) {
      const entry: JobListEntry = { id: "job-1", delete_on_save: reason };
      expect(entry.delete_on_save).toBe(reason);
    }
  });
});
