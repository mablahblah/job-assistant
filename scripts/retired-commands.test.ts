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

// Criteria "The old folder is gone", "The catch-all command is gone", "The
// kept skill names its break", and "The research keeps its place". The old
// pipeline is deleted in one move, and these pin what that move takes with
// it and what it must leave standing.
describe("the deleted old pipeline", () => {
  test("legacy/ does not exist", () => {
    expect(existsSync(join(repoRoot, "legacy"))).toBe(false);
  });

  test("the cli entry is gone from package.json", () => {
    expect(npmScripts()["cli"]).toBeUndefined();
  });

  test("the kept add-external-jobs skill names the switch over as its break", () => {
    const skill = readFileSync(
      join(repoRoot, ".claude", "skills", "add-external-jobs", "SKILL.md"),
      "utf8"
    );
    expect(skill).toContain("switch over");
  });

  test("the five research scripts keep their place", () => {
    const researchDir = join(repoRoot, "docs", "features", "unified-pipeline", "location-research");
    const scripts = [
      join(researchDir, "spike", "build-cache.ts"),
      join(researchDir, "spike", "count.ts"),
      join(researchDir, "spike", "classify.ts"),
      join(researchDir, "spike2", "build-cache.ts"),
      join(researchDir, "spike2", "classify.ts"),
    ];
    for (const script of scripts) {
      expect(existsSync(script), script).toBe(true);
    }
  });
});
