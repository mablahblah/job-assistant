// Flow test: The seed adds the new sources.
//
// A database whose source ranking list was filled before this feature, then
// the seed command run exactly as the user runs it. The ranking list decides
// which source's value survives when two disagree, and a source missing from
// it loses every contested field to any source on it — so a new parser or
// collector that never reached the list would lose its description to Adzuna's.
//
// Covers: The Workday parser is on the ranking list, The Workday collector is
// on the ranking list, The UltiPro parser is on the ranking list, The UltiPro
// collector is on the ranking list.
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createClient } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

// This file lives in scripts/, so the repo root is one level up.
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");

// Creating and seeding twice each spawn npx tsx. A ceiling rather than a
// budget.
const SETUP_TIMEOUT_MS = 120_000;

// The ranking list the seed wrote before this feature, in its order.
const LIST_BEFORE_THIS_FEATURE = [
  "collector:user",
  "parser:greenhouse",
  "parser:lever",
  "parser:ashby",
  "parser:dribbble",
  "collector:adzuna",
  "collector:jsearch",
  "collector:greenhouse",
  "collector:lever",
  "collector:ashby",
  "collector:dribbble",
  "collector:uiuxjobsboard",
];

function runScript(script: string, url: string): void {
  const args = script === "db-create.ts" ? [url] : [];
  execFileSync("npx", ["tsx", `scripts/${script}`, ...args], {
    cwd: repoRoot,
    env: { ...process.env, PIPELINE_DATABASE_URL: url },
    stdio: "pipe",
  });
}

async function execute(url: string, sql: string, args: string[] = []) {
  const client = createClient({ url });
  try {
    return await client.execute({ sql, args });
  } finally {
    client.close();
  }
}

describe("The seed adds the new sources", () => {
  let dir: string;
  let rankingList: string[];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "pipeline-seed-new-sources-flow-"));
    const url = `file:${join(dir, "pipeline.db")}`;
    runScript("db-create.ts", url);
    runScript("db-seed.ts", url);

    // Put the list back to the one a database held before this feature.
    await execute(url, "UPDATE Setting SET source_priority_list = ? WHERE id = 1", [
      JSON.stringify(LIST_BEFORE_THIS_FEATURE),
    ]);

    runScript("db-seed.ts", url);

    const result = await execute(url, "SELECT source_priority_list FROM Setting WHERE id = 1");
    rankingList = JSON.parse(String(result.rows[0]?.["source_priority_list"] ?? "[]")) as string[];
  }, SETUP_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("The Workday parser is on the ranking list", () => {
    expect(rankingList).toContain("parser:workday");
  });

  test("The Workday collector is on the ranking list", () => {
    expect(rankingList).toContain("collector:workday");
  });

  test("The UltiPro parser is on the ranking list", () => {
    expect(rankingList).toContain("parser:ultipro");
  });

  test("The UltiPro collector is on the ranking list", () => {
    expect(rankingList).toContain("collector:ultipro");
  });
});
