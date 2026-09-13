// Creates the pipeline database from scratch. Deleting the file and pushing
// the schema is how the database is recreated after a schema change — it
// holds nothing worth keeping until active jobs and the work log migrate in.
// Loads .env, which is where the database url normally lives. A caller that
// sets PIPELINE_DATABASE_URL itself still wins, because dotenv never
// overwrites a variable that is already set.
import "dotenv/config";
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { getPipelineDatabaseUrl } from "../lib/db/pipeline-env";

// This script lives in scripts/, so the repo root is one level up. Prisma
// resolves a relative database url from the directory holding
// prisma.config.ts — the repo root — rather than from the working directory,
// so the same resolution is applied here.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolveDbPath(databaseUrl: string): string {
  const withoutScheme = databaseUrl.replace(/^file:/, "");
  return path.isAbsolute(withoutScheme)
    ? withoutScheme
    : path.resolve(repoRoot, withoutScheme);
}

// Throws when PIPELINE_DATABASE_URL is unset. That failure is wanted: a run
// without it must stop rather than reach the database job searches depend on.
const dbPath = resolveDbPath(getPipelineDatabaseUrl());

// Remove the database and any sidecar files sqlite left behind, so the push
// builds from nothing instead of merging onto an old file.
const removed = [dbPath, `${dbPath}-journal`, `${dbPath}-wal`, `${dbPath}-shm`].filter(
  (candidate) => existsSync(candidate)
);
for (const candidate of removed) {
  unlinkSync(candidate);
}
console.log(removed.length > 0 ? `Removed ${removed.join(", ")}` : "No database to remove");

// prisma.config.ts already names the schema and reads the same url, so no
// --schema or --url is needed. The environment passes through unchanged, so
// a caller pointing PIPELINE_DATABASE_URL at a scratch file is honoured.
execFileSync("npx", ["prisma", "db", "push"], { cwd: repoRoot, stdio: "inherit" });

console.log(`Created ${dbPath}`);
