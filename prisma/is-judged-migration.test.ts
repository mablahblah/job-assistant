import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createClient, type Client } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

// This file lives in prisma/, so the migrations sit one folder down.
const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), "migrations");

function migrationSql(name: string): string {
  return readFileSync(join(migrationsDir, name, "migration.sql"), "utf-8");
}

// Jobs stored before the judged marker existed are marked once, by the rule
// scoring applies from then on: judged only when the link was followed, the
// posting read, the location checked, and the job or its employer holds a
// score. The database is built from the baseline migration rather than the
// current schema, because the fill has to run against rows that predate the
// column, the way it will against the real database.
describe("the judged marker migration marks stored jobs once", () => {
  let dir: string;
  let client: Client;

  const ALL_STEPS_DONE = { is_resolved: 1, is_parsed: 1, is_classified: 1 };

  async function insertCompany(id: string, scores: Record<string, number>): Promise<void> {
    const columns = ["id", "modified_at", ...Object.keys(scores)];
    const values = [id, "2026-01-01T00:00:00.000Z", ...Object.values(scores)];
    await client.execute({
      sql: `INSERT INTO Company (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
      args: values,
    });
  }

  async function insertJob(id: string, fields: Record<string, string | number>): Promise<void> {
    const columns = ["id", "collected_at", "modified_at", ...Object.keys(fields)];
    const values = [id, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", ...Object.values(fields)];
    await client.execute({
      sql: `INSERT INTO Job (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
      args: values,
    });
  }

  async function isJudged(id: string): Promise<boolean> {
    const result = await client.execute({ sql: "SELECT is_judged FROM Job WHERE id = ?", args: [id] });
    const record = result.rows[0] as unknown as Record<string, unknown>;
    return Number(record["is_judged"]) === 1;
  }

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "is-judged-migration-test-"));
    client = createClient({ url: `file:${join(dir, "pipeline.db")}` });
    await client.executeMultiple(migrationSql("0_init"));

    await insertCompany("scored-employer", {
      employee_satisfaction: 4,
      customer_satisfaction: 4,
      work_life_balance: 4,
      political_alignment: 4,
    });
    // One category is enough: an employer holding any score counts.
    await insertCompany("partly-scored-employer", { political_alignment: 3 });
    await insertCompany("unscored-employer", {});

    await insertJob("fit-scored", { ...ALL_STEPS_DONE, alignment_score: 4 });
    await insertJob("employer-scored", { ...ALL_STEPS_DONE, company_id: "scored-employer" });
    await insertJob("employer-partly-scored", {
      ...ALL_STEPS_DONE,
      company_id: "partly-scored-employer",
    });
    await insertJob("employer-unscored", { ...ALL_STEPS_DONE, company_id: "unscored-employer" });
    await insertJob("no-employer-no-score", { ...ALL_STEPS_DONE });
    await insertJob("link-not-followed", {
      ...ALL_STEPS_DONE,
      is_resolved: 0,
      company_id: "scored-employer",
    });
    await insertJob("posting-not-read", {
      ...ALL_STEPS_DONE,
      is_parsed: 0,
      company_id: "scored-employer",
    });
    await insertJob("location-not-checked", {
      ...ALL_STEPS_DONE,
      is_classified: 0,
      company_id: "scored-employer",
    });

    await client.executeMultiple(migrationSql("20260919000000_add_is_judged"));
  });

  afterAll(() => {
    client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("a job holding a fit score is judged", async () => {
    expect(await isJudged("fit-scored")).toBe(true);
  });

  test("a job whose employer holds every score is judged", async () => {
    expect(await isJudged("employer-scored")).toBe(true);
  });

  test("a job whose employer holds one score is judged", async () => {
    expect(await isJudged("employer-partly-scored")).toBe(true);
  });

  test("a job whose employer holds no score is unjudged", async () => {
    expect(await isJudged("employer-unscored")).toBe(false);
  });

  test("a job with no employer and no fit score is unjudged", async () => {
    expect(await isJudged("no-employer-no-score")).toBe(false);
  });

  test("a job whose link was not followed is unjudged, even with a scored employer", async () => {
    expect(await isJudged("link-not-followed")).toBe(false);
  });

  test("a job whose posting was not read is unjudged, even with a scored employer", async () => {
    expect(await isJudged("posting-not-read")).toBe(false);
  });

  test("a job whose location was not checked is unjudged, even with a scored employer", async () => {
    expect(await isJudged("location-not-checked")).toBe(false);
  });
});
