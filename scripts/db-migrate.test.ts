import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createClient } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

// This file lives in scripts/, so the repo root is one level up.
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");

// Creating plus migrating spawns the prisma CLI more than once. A ceiling
// rather than a budget: vitest runs these child processes in parallel and
// they contend for the machine.
const SETUP_TIMEOUT_MS = 240_000;

// One scratch database serves the whole block: it is built the way the real
// one is — by the create command — given one row of real content, and then
// run through the migrate command once. Every test reads the aftermath.
describe("the schema-change command", () => {
  let dir: string;
  let dbPath: string;
  let url: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "db-migrate-test-"));
    dbPath = join(dir, "pipeline.db");
    url = `file:${dbPath}`;

    execFileSync("npx", ["tsx", "scripts/db-create.ts", url], {
      cwd: repoRoot,
      env: { ...process.env, PIPELINE_DATABASE_URL: url },
      stdio: "pipe",
    });

    // One row of content, so preservation is provable rather than vacuous.
    const seed = createClient({ url });
    return seed
      .execute(
        "INSERT INTO Job (id, collector, collected_at, modified_at) VALUES ('job-1', 'user', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')"
      )
      .then(() => seed.close());
  }, SETUP_TIMEOUT_MS);

  beforeAll(() => {
    execFileSync("npx", ["tsx", "scripts/db-migrate.ts"], {
      cwd: repoRoot,
      env: { ...process.env, PIPELINE_DATABASE_URL: url },
      stdio: "pipe",
    });
  }, SETUP_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function backupFiles(): string[] {
    return readdirSync(dir).filter((name) => name.includes("backup"));
  }

  // Criterion "A dated copy precedes the change".
  test("a dated copy of the file exists beside it", () => {
    const backups = backupFiles();
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  test("the copy holds the file as it stood before anything was altered", async () => {
    const backup = createClient({ url: `file:${join(dir, backupFiles()[0] ?? "")}` });
    try {
      // The migrate run is what writes prisma's history table, so a copy
      // taken before any alteration cannot contain it.
      const tables = await backup.execute(
        "SELECT name FROM sqlite_master WHERE name = '_prisma_migrations'"
      );
      expect(tables.rows).toHaveLength(0);

      const rows = await backup.execute("SELECT id FROM Job");
      expect(rows.rows.map((row) => row["id"])).toEqual(["job-1"]);
    } finally {
      backup.close();
    }
  });

  // Criterion "A schema change preserves rows".
  test("every stored row survives the run", async () => {
    const db = createClient({ url });
    try {
      const rows = await db.execute("SELECT id FROM Job");
      expect(rows.rows.map((row) => row["id"])).toEqual(["job-1"]);
    } finally {
      db.close();
    }
  });

  // A database the create command built carries no migration history, so the
  // command has to adopt it into the workflow rather than refuse it.
  test("the run leaves the database inside the migration workflow", async () => {
    const db = createClient({ url });
    try {
      const applied = await db.execute("SELECT migration_name FROM _prisma_migrations");
      expect(applied.rows.length).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  test("db:migrate is registered in package.json", () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.["db:migrate"]).toMatch(/scripts\/db-migrate\.ts/);
  });
});
