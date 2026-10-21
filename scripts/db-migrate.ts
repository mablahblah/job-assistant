import "dotenv/config";
import { existsSync, copyFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createClient } from "@libsql/client";
import { getPipelineDatabaseUrl } from "../lib/db/pipeline-env";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolveDbPath(databaseUrl: string): string {
  const withoutScheme = databaseUrl.replace(/^file:/, "");
  return path.isAbsolute(withoutScheme)
    ? withoutScheme
    : path.resolve(repoRoot, withoutScheme);
}

function refuse(message: string): never {
  console.error(message);
  process.exit(1);
}

// Queried directly instead of through Prisma: at this point we don't yet
// know whether the database has migration history, and Prisma's migrate
// commands assume it does — this is how we find out.
async function hasMigrationsTable(dbPath: string): Promise<boolean> {
  const client = createClient({ url: `file:${dbPath}` });
  try {
    const result = await client.execute({
      sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      args: ["_prisma_migrations"],
    });
    return result.rows.length > 0;
  } finally {
    client.close();
  }
}

// db:create builds a database with `prisma db push`, which lays down the
// full current schema but no migration history. Telling Prisma each
// existing migration directory is already applied adopts that database
// into the normal migration workflow without replaying any of them.
function adoptExistingMigrations(dbPath: string): void {
  const migrationsDir = path.join(repoRoot, "prisma", "migrations");
  const migrationNames = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const name of migrationNames) {
    execFileSync("npx", ["prisma", "migrate", "resolve", "--applied", name], {
      cwd: repoRoot,
      stdio: "inherit",
      env: { ...process.env, PIPELINE_DATABASE_URL: `file:${dbPath}` },
    });
  }
}

async function main(): Promise<void> {
  const databaseUrl = getPipelineDatabaseUrl();
  const dbPath = resolveDbPath(databaseUrl);

  if (!existsSync(dbPath)) {
    refuse(`No database at ${dbPath} — nothing to migrate. Run db:create first.`);
  }

  // The backup is written before anything else touches the file, so a
  // botched migration can never leave us without a copy of what came before.
  const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
  const backupPath = `${dbPath}.${timestamp}.backup`;
  copyFileSync(dbPath, backupPath);
  console.log(`Backed up database to ${backupPath}`);

  const alreadyTracked = await hasMigrationsTable(dbPath);
  if (!alreadyTracked) {
    adoptExistingMigrations(dbPath);
  }

  const migrateArgs = ["prisma", "migrate", "dev"];
  const name = process.argv[2];
  if (name) {
    migrateArgs.push("--name", name);
  }

  // With no pending schema change, migrate dev reports "already in sync" and
  // touches neither the database nor the generated client — measured, which
  // is what lets the test suite run this command safely. A real change does
  // not regenerate the client either; run `npx prisma generate` after it.
  execFileSync("npx", migrateArgs, {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, PIPELINE_DATABASE_URL: `file:${dbPath}` },
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
