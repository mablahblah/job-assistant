// Rebuilds a database from the Prisma schema. The target is the caller's
// job: this script takes no default, so a bare mistyped invocation cannot
// land on a database anyone cares about. The one database it refuses no
// matter what is the one named by PIPELINE_DATABASE_URL in the repo's own
// .env file — read directly here, not from process.env, so a shell that
// happens to export a different value cannot make a wipe of the real file
// look safe.
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { parse as parseEnvFile } from "dotenv";

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

function refuse(message: string): never {
  console.error(message);
  process.exit(1);
}

const targetArg = process.argv[2];
if (!targetArg) {
  refuse("Refusing: no target database given. Pass a path or file: url as the only argument.");
}

const targetPath = resolveDbPath(targetArg);

// No .env, or an .env without PIPELINE_DATABASE_URL, means there is no real
// file on record to protect — any target is fine.
const envPath = path.join(repoRoot, ".env");
if (existsSync(envPath)) {
  const parsedEnv = parseEnvFile(readFileSync(envPath, "utf8"));
  const realDbUrl = parsedEnv["PIPELINE_DATABASE_URL"];
  if (realDbUrl) {
    const realDbPath = resolveDbPath(realDbUrl);
    if (targetPath === realDbPath) {
      refuse(`Refusing: ${targetPath} is the real database named by PIPELINE_DATABASE_URL in .env.`);
    }
  }
}

// Remove the database and any sidecar files sqlite left behind, so the push
// builds from nothing instead of merging onto an old file.
const removed = [targetPath, `${targetPath}-journal`, `${targetPath}-wal`, `${targetPath}-shm`].filter(
  (candidate) => existsSync(candidate)
);
for (const candidate of removed) {
  unlinkSync(candidate);
}
console.log(removed.length > 0 ? `Removed ${removed.join(", ")}` : "No database to remove");

// prisma.config.ts reads PIPELINE_DATABASE_URL from the environment, so the
// target is passed through the child's env rather than relying on whatever
// the parent process happened to have set.
execFileSync("npx", ["prisma", "db", "push"], {
  cwd: repoRoot,
  stdio: "inherit",
  env: { ...process.env, PIPELINE_DATABASE_URL: `file:${targetPath}` },
});

console.log(`Created ${targetPath}`);
