import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createPipelineDb } from "../db/pipeline-db";
import { createLastSuccessService, type LastSuccessService } from "./last-success-service";

// This file lives in lib/, so the repo root is one level up.
const libDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(libDir, "..", "..");

// Creating the scratch database runs the prisma CLI in a child process, which
// is the slow part. A ceiling rather than a budget: vitest runs these child
// processes in parallel and they contend for the machine.
const CREATE_TIMEOUT_MS = 120_000;

const FIRST_SUCCESS = new Date("2026-10-20T14:00:00.000Z");
const LATER_SUCCESS = new Date("2026-10-21T15:30:00.000Z");

type PipelineDb = ReturnType<typeof createPipelineDb>;

// An absolute url, because a relative Prisma url resolves from the directory
// holding prisma.config.ts rather than from the working directory.
function createDb(prefix: string): { dir: string; url: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const url = `file:${join(dir, "pipeline.db")}`;
  execFileSync("npx", ["tsx", "scripts/db-create.ts", url], {
    cwd: repoRoot,
    env: { ...process.env, PIPELINE_DATABASE_URL: url },
    stdio: "pipe",
  });
  return { dir, url };
}

// Points a real client at the scratch database. createPipelineDb reads the url
// at call time, so the environment only has to hold the scratch value for the
// moment of construction, and whatever was there before is put back.
function buildService(url: string): { db: PipelineDb; service: LastSuccessService } {
  const previous = process.env["PIPELINE_DATABASE_URL"];
  process.env["PIPELINE_DATABASE_URL"] = url;
  const db = createPipelineDb();
  if (previous === undefined) delete process.env["PIPELINE_DATABASE_URL"];
  else process.env["PIPELINE_DATABASE_URL"] = previous;
  return { db, service: createLastSuccessService(db) };
}

describe("the last-success service", () => {
  let dir: string;
  let db: PipelineDb;
  let service: LastSuccessService;

  beforeAll(() => {
    const temp = createDb("pipeline-last-success-service-");
    dir = temp.dir;
    ({ db, service } = buildService(temp.url));
  }, CREATE_TIMEOUT_MS);

  afterAll(async () => {
    await db.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  // A search with no saved time has never worked, which the collector reads
  // as "look back as far as the settings allow" rather than as a failure.
  test("a search that never worked has no time", async () => {
    expect(await service.find("never-worked", "remote")).toBeNull();
  });

  test("a recorded time is found again", async () => {
    await service.record("recorded", "remote", FIRST_SUCCESS);
    expect(await service.find("recorded", "remote")).toEqual(FIRST_SUCCESS);
  });

  test("a later time replaces the earlier one", async () => {
    await service.record("replaced", "remote", FIRST_SUCCESS);
    await service.record("replaced", "remote", LATER_SUCCESS);
    expect(await service.find("replaced", "remote")).toEqual(LATER_SUCCESS);
  });

  // The two searches keep their own times, so a failed search keeps its gap
  // while the other moves on.
  test("one search's time leaves the other search alone", async () => {
    await service.record("two-searches", "remote", FIRST_SUCCESS);
    await service.record("two-searches", "austin", LATER_SUCCESS);
    expect(await service.find("two-searches", "remote")).toEqual(FIRST_SUCCESS);
  });

  test("one collector's time leaves another collector's search alone", async () => {
    await service.record("first-collector", "remote", FIRST_SUCCESS);
    expect(await service.find("second-collector", "remote")).toBeNull();
  });
});
