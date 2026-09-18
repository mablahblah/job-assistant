import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// This file lives in scripts/, so the repo root is one level up.
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");

// The skills are instructions rather than code, so their criteria are proven
// by reading the files, the way generate-resume-skill.test.ts already does.
function skillFile(name: string): string {
  return readFileSync(join(repoRoot, ".claude", "skills", name, "SKILL.md"), "utf8");
}

describe("the job-search skill and the run identifier", () => {
  const skill = skillFile("job-search");

  test("its output contract names the Run line", () => {
    expect(skill).toContain("Run: ");
  });

  test("its scoring step says to pass the identifier it read", () => {
    // The identifier must reach score-backlog from the skill that read it,
    // or the two halves of one search land in different counting buckets.
    expect(skill.toLowerCase()).toContain("run identifier");
  });
});

describe("the score-backlog skill and the run identifier", () => {
  const skill = skillFile("score-backlog");

  test("it passes an identifier whenever one is held", () => {
    expect(skill).toContain("If you hold a run identifier");
  });

  test("it no longer limits the flag to a user-handed identifier", () => {
    expect(skill).not.toContain("If the user handed you a run identifier");
  });
});
