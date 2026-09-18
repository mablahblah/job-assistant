import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { parse as parseEnvFile } from "dotenv";
import { afterAll, describe, expect, test } from "vitest";

// This file lives in scripts/, so the repo root is one level up.
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");

// Creating a database spawns the prisma CLI, measured well under two seconds.
// This is a ceiling rather than a budget: vitest runs these child processes
// in parallel and they contend for the machine.
const CREATE_TIMEOUT_MS = 120_000;

// The real database file, read from .env itself rather than the process
// environment, because the guard under test protects the file .env names
// no matter what the environment says.
const envFile = parseEnvFile(readFileSync(join(repoRoot, ".env"), "utf8"));
const realDbUrl = envFile["PIPELINE_DATABASE_URL"];
if (!realDbUrl) {
  throw new Error("The repo's .env names no PIPELINE_DATABASE_URL — nothing to test against.");
}
const realDbPathRaw = realDbUrl.replace(/^file:/, "");
const realDbPath = isAbsolute(realDbPathRaw) ? realDbPathRaw : resolve(repoRoot, realDbPathRaw);

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "db-create-test-"));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Runs the script and hands back the exit code, swallowing the throw
// execFileSync raises on a nonzero exit.
function runDbCreate(args: string[], env: NodeJS.ProcessEnv): number {
  try {
    execFileSync("npx", ["tsx", "scripts/db-create.ts", ...args], {
      cwd: repoRoot,
      env,
      stdio: "pipe",
    });
    return 0;
  } catch (thrown) {
    const status = (thrown as { status?: number | null }).status;
    if (typeof status !== "number") throw thrown;
    return status;
  }
}

describe("the rebuild command's target guard", () => {
  test(
    "no argument refuses and deletes nothing",
    () => {
      // A database file the environment points at, the way every run before
      // this guard reached its target. The guard must refuse rather than
      // fall back to it.
      const dir = makeTempDir();
      const dbPath = join(dir, "pipeline.db");
      writeFileSync(dbPath, "do not delete me");

      const exitCode = runDbCreate([], {
        ...process.env,
        PIPELINE_DATABASE_URL: `file:${dbPath}`,
      });

      expect(exitCode).not.toBe(0);
      expect(readFileSync(dbPath, "utf8")).toBe("do not delete me");
    },
    CREATE_TIMEOUT_MS
  );

  test(
    "the file .env names is refused as written and left untouched",
    () => {
      // The environment points at a scratch file so that a run of this test
      // before the guard exists — when the script still reads its target from
      // the environment — can only ever wipe scratch, never the real file.
      const dir = makeTempDir();
      const scratch = join(dir, "scratch.db");
      const before = existsSync(realDbPath) ? statSync(realDbPath) : null;

      const exitCode = runDbCreate([realDbUrl], {
        ...process.env,
        PIPELINE_DATABASE_URL: `file:${scratch}`,
      });

      expect(exitCode).not.toBe(0);
      const after = existsSync(realDbPath) ? statSync(realDbPath) : null;
      expect(after?.size).toBe(before?.size);
      expect(after?.mtimeMs).toBe(before?.mtimeMs);
    },
    CREATE_TIMEOUT_MS
  );

  test(
    "the file .env names is refused as an absolute path too",
    () => {
      // The same file spelled differently. A guard comparing strings rather
      // than resolved paths would let this one through. The scratch
      // environment protects the real file the same way the test above does.
      const dir = makeTempDir();
      const scratch = join(dir, "scratch.db");
      const before = existsSync(realDbPath) ? statSync(realDbPath) : null;

      const exitCode = runDbCreate([realDbPath], {
        ...process.env,
        PIPELINE_DATABASE_URL: `file:${scratch}`,
      });

      expect(exitCode).not.toBe(0);
      const after = existsSync(realDbPath) ? statSync(realDbPath) : null;
      expect(after?.size).toBe(before?.size);
      expect(after?.mtimeMs).toBe(before?.mtimeMs);
    },
    CREATE_TIMEOUT_MS
  );

  test(
    "a scratch target is created at the argument's path, not the environment's",
    () => {
      // The environment points at one file and the argument at another. The
      // argument must win: the database appears at the argument's path and
      // the environment's file is never touched.
      const dir = makeTempDir();
      const envPath = join(dir, "env-pointed.db");
      const targetPath = join(dir, "target.db");
      writeFileSync(envPath, "the environment's file");

      const exitCode = runDbCreate([`file:${targetPath}`], {
        ...process.env,
        PIPELINE_DATABASE_URL: `file:${envPath}`,
      });

      expect(exitCode).toBe(0);
      expect(existsSync(targetPath)).toBe(true);
      expect(readFileSync(envPath, "utf8")).toBe("the environment's file");
    },
    CREATE_TIMEOUT_MS
  );
});
