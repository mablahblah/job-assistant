import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getPipelineDatabaseUrl } from "./lib/pipeline-env";

const repoRoot = dirname(fileURLToPath(import.meta.url));

// The first test to touch prisma.config.ts pays a cold import of it, dotenv,
// and the Prisma config loader — measured at 318ms alone, and longer when the
// full suite's workers compete for the CPU. A ceiling, not a budget.
const CONFIG_LOAD_TIMEOUT_MS = 10_000;

let envSnapshot: NodeJS.ProcessEnv;

beforeEach(() => {
  envSnapshot = { ...process.env };
});

afterEach(() => {
  process.env = { ...envSnapshot };
  vi.doUnmock("./lib/pipeline-env");
  vi.resetModules();
});

// Loads prisma.config.ts fresh, with the pipeline url supplied by the test
// rather than by .env, so a clone without an .env file still runs these.
async function loadConfig() {
  process.env.PIPELINE_DATABASE_URL = "file:./pipeline-marker.db";
  vi.resetModules();
  return (await import("./prisma.config")).default;
}

describe("AC1: prisma.config.ts targets the new pipeline schema and env var", () => {
  test("points the schema outside legacy/", async () => {
    const config = await loadConfig();
    expect(config.schema).toBe("prisma/schema.prisma");
    expect(config.schema).not.toMatch(/legacy/);
  }, CONFIG_LOAD_TIMEOUT_MS);

  test("points migrations outside legacy/", async () => {
    const config = await loadConfig();
    expect(config.migrations?.path).toBe("prisma/migrations");
    expect(config.migrations?.path).not.toMatch(/legacy/);
  }, CONFIG_LOAD_TIMEOUT_MS);

  test("resolves the datasource url from PIPELINE_DATABASE_URL, not DATABASE_URL", async () => {
    // dotenv never overwrites a variable that is already set, so setting both
    // before the import proves which one the config actually reads.
    process.env.DATABASE_URL = "file:./legacy-marker.db";
    const config = await loadConfig();
    expect(config.datasource?.url).toBe("file:./pipeline-marker.db");
  }, CONFIG_LOAD_TIMEOUT_MS);

  test("does not reference DATABASE_URL in source", () => {
    const source = readFileSync(resolve(repoRoot, "prisma.config.ts"), "utf-8");
    expect(source).not.toMatch(/\bDATABASE_URL\b/);
  });
});

describe("AC2: the pipeline database url has no fallback", () => {
  test("getPipelineDatabaseUrl throws a clear error when PIPELINE_DATABASE_URL is unset", () => {
    delete process.env.PIPELINE_DATABASE_URL;
    expect(() => getPipelineDatabaseUrl()).toThrow(/PIPELINE_DATABASE_URL/);
  });

  test("getPipelineDatabaseUrl does not fall back to DATABASE_URL when unset", () => {
    delete process.env.PIPELINE_DATABASE_URL;
    process.env.DATABASE_URL = "file:./dev.db";
    expect(() => getPipelineDatabaseUrl()).toThrow();
  });

  test("loading prisma.config.ts throws when the lookup fails", async () => {
    // Proves prisma.config.ts is wired to getPipelineDatabaseUrl: if the
    // lookup throws, loading the config throws too. Mocked rather than
    // deleting the variable and re-importing, because that import would let
    // dotenv repopulate it from .env before the throw could fire.
    vi.resetModules();
    vi.doMock("./lib/pipeline-env", () => ({
      getPipelineDatabaseUrl: () => {
        throw new Error("PIPELINE_DATABASE_URL is not set.");
      },
    }));
    await expect(import("./prisma.config")).rejects.toThrow(
      "PIPELINE_DATABASE_URL is not set."
    );
  }, CONFIG_LOAD_TIMEOUT_MS);
});

describe("AC3: pipeline.db stays out of git", () => {
  test("git ignores pipeline.db per the repo's ignore rules", () => {
    expect(runGitCheckIgnore("pipeline.db")).toBe(true);
  });

  test("pipeline.db is not tracked by git", () => {
    const tracked = execFileSync("git", ["ls-files", "pipeline.db"], {
      cwd: repoRoot,
      encoding: "utf-8",
    });
    expect(tracked.trim()).toBe("");
  });
});

// git check-ignore exits 0 when a path matches an ignore rule and 1 when it
// does not. Anything above 1 is a real failure and is rethrown.
function runGitCheckIgnore(path: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "-q", path], { cwd: repoRoot });
    return true;
  } catch (error) {
    const err = error as { status?: number };
    if (err.status === 1) return false;
    throw error;
  }
}
