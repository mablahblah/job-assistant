import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// This file lives in scripts/, so the repo root is one level up.
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");

function npmScripts(): Record<string, string> {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8")) as {
    scripts?: Record<string, string>;
  };
  return pkg.scripts ?? {};
}

// Criteria "The reset script is gone" and "The reset script's test file is
// gone". The reset existed because the database held nothing worth keeping,
// and the switch over is what ends that — from then on a command that empties
// the database is a loaded gun on the shelf.
describe("the retired reset command", () => {
  test("the script is gone", () => {
    expect(existsSync(join(scriptsDir, "db-reset.ts"))).toBe(false);
  });

  test("its npm entry is gone", () => {
    expect(npmScripts()["db:reset"]).toBeUndefined();
  });

  test("its test file is gone", () => {
    expect(existsSync(join(scriptsDir, "db-reset.test.ts"))).toBe(false);
  });
});
