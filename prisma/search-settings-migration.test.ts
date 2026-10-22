import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createClient, type Client } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

// This file lives in prisma/, so the migrations sit one folder down.
const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), "migrations");

const MIGRATIONS_BEFORE = [
  "0_init",
  "20260919000000_add_is_judged",
  "20260923155709_add_identifying_query_values",
];
const MIGRATION = "20261022062124_add_last_success_and_search_settings";

function migrationSql(name: string): string {
  return readFileSync(join(migrationsDir, name, "migration.sql"), "utf-8");
}

// The ranking as the real database held it before this migration: ordered by
// hand, every parser first, then the board collectors, then the scraping and
// API collectors.
const RANKING_BEFORE = [
  "collector:user",
  "parser:greenhouse",
  "parser:lever",
  "parser:ashby",
  "parser:workday",
  "parser:ultipro",
  "parser:dribbble",
  "parser:gem",
  "parser:smartrecruiters",
  "parser:bamboohr",
  "parser:rippling",
  "parser:workable",
  "parser:general",
  "collector:greenhouse",
  "collector:lever",
  "collector:ashby",
  "collector:workday",
  "collector:ultipro",
  "collector:gem",
  "collector:smartrecruiters",
  "collector:bamboohr",
  "collector:rippling",
  "collector:workable",
  "collector:uiuxjobsboard",
  "collector:dribbble",
  "collector:adzuna",
  "collector:jsearch",
];

const ENTRY = "collector:fantastic-jobs";

// The stored settings are changed once, by hand-written SQL, because the seed
// only fills what is empty and never reorders. The database is built from the
// migrations before this one and given a settings row written the way the real
// one is stored, with a space after every comma.
describe("the search settings migration updates the stored ranking and link parts", () => {
  let dir: string;
  let client: Client;

  async function readList(column: string): Promise<string[]> {
    const result = await client.execute(`SELECT ${column} FROM Setting WHERE id = 1`);
    const raw = result.rows[0]?.[column];
    return JSON.parse(String(raw)) as string[];
  }

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "search-settings-migration-test-"));
    client = createClient({ url: `file:${join(dir, "pipeline.db")}` });
    for (const name of MIGRATIONS_BEFORE) {
      await client.executeMultiple(migrationSql(name));
    }
    await client.execute({
      sql: "INSERT INTO Setting (id, source_priority_list, identifying_query_values, modified_at) VALUES (1, ?, ?, ?)",
      args: [
        JSON.stringify(RANKING_BEFORE).replace(/","/g, '", "'),
        '["opportunityid"]',
        "2026-10-01T00:00:00.000Z",
      ],
    });

    await client.executeMultiple(migrationSql(MIGRATION));
  });

  afterAll(() => {
    client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("the new collector sits directly after Workable's collector", async () => {
    const ranking = await readList("source_priority_list");
    expect(ranking.indexOf(ENTRY)).toBe(ranking.indexOf("collector:workable") + 1);
  });

  test("every other source keeps its place relative to the others", async () => {
    const ranking = await readList("source_priority_list");
    expect(ranking.filter((source) => source !== ENTRY)).toEqual(RANKING_BEFORE);
  });

  test("the identifying values gain reqId and gh_jid beside what they held", async () => {
    expect(await readList("identifying_query_values")).toEqual(["opportunityid", "reqId", "gh_jid"]);
  });
});
