import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// This file lives in scripts/, so the repo root is one level up.
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");

// The skill is instructions rather than code, so its criteria are proven the
// way serve.test.ts proves a word absent: by reading the file. The exact
// phrases pinned here are the skill's contract with the commands it calls.
const skill = readFileSync(
  join(repoRoot, ".claude", "skills", "generate-resume", "SKILL.md"),
  "utf8"
);

describe("the resume skill and the old folder", () => {
  test("no line calls the old command path", () => {
    expect(skill).not.toContain("scripts/cli.ts");
  });
});

// Every line that runs the lookup command. The posting fetch also takes
// --url, so the lookup's own flags are read off these lines alone.
const lookupLines = skill.split("\n").filter((line) => line.includes("npm run find-jobs"));

describe("the resume skill's job lookup", () => {
  test("it calls the new command", () => {
    expect(lookupLines.length).toBeGreaterThan(0);
  });

  // Find a job by its link: a pasted link reaches the lookup.
  test("it passes a link to the lookup", () => {
    expect(lookupLines.some((line) => line.includes("--url"))).toBe(true);
  });

  test("it passes an employer to the lookup", () => {
    expect(lookupLines.some((line) => line.includes("--company"))).toBe(true);
  });

  // Role words do not narrow the search: the agent picks the job from the
  // employer's jobs, so neither the role nor the removed title flag reaches
  // the lookup.
  test("it never passes the role to the lookup", () => {
    for (const line of lookupLines) {
      expect(line).not.toContain("--title");
      expect(line).not.toContain("{role}");
    }
  });

  // The command prints one data answer and no longer takes --json.
  test("it no longer asks for the removed answer setting", () => {
    expect(skill).not.toContain("--json");
  });
});

describe("the resume skill's posting fetch", () => {
  test("it fetches through the rendered-page command", () => {
    expect(skill).toContain("fetch-rendered-page");
    expect(skill).toContain("--url");
  });

  test("it prefers the source posting's link and falls back to the collected one", () => {
    expect(skill).toContain("resolved_url");
    expect(skill).toContain("original_url");
  });

  test("a fetch that errors or times out is called a tool failure", () => {
    expect(skill.toLowerCase()).toContain("tool failure");
  });
});

describe("the resume skill's dead-posting branch", () => {
  test("it closes with a message and writes no status", () => {
    // The old skill closed this branch by marking the job expired. The
    // 2026-09-16 ruling ended that: a posting that will not load is not
    // evidence the job is gone, so no status command appears at all.
    expect(skill).not.toContain("change-status");
    expect(skill).not.toContain('"expired"');
  });
});
