import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createPipelineDb } from "../db/pipeline-db";
import { createPlaceService, type PlaceService } from "./place-service";

// This file lives in lib/, so the repo root is one level up.
const libDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(libDir, "..", "..");

// Creating the scratch database runs the prisma CLI in a child process, which
// is the slow part. A ceiling rather than a budget.
// Raised from 45 seconds, which a full-suite run exceeded: vitest runs
// these child processes in parallel and they contend for the machine.
const CREATE_TIMEOUT_MS = 120_000;

type PipelineDb = ReturnType<typeof createPipelineDb>;

// An absolute url, because a relative Prisma url resolves from the directory
// holding prisma.config.ts rather than from the working directory.
function createDb(prefix: string): { dir: string; url: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const url = `file:${join(dir, "pipeline.db")}`;
  execFileSync("npx", ["tsx", "scripts/db-create.ts"], {
    cwd: repoRoot,
    env: { ...process.env, PIPELINE_DATABASE_URL: url },
    stdio: "pipe",
  });
  return { dir, url };
}

// Points a real client at the scratch database. createPipelineDb reads the url
// at call time, so the environment only has to hold the scratch value for the
// moment of construction, and whatever was there before is put back.
function buildService(url: string): { db: PipelineDb; service: PlaceService } {
  const previous = process.env["PIPELINE_DATABASE_URL"];
  process.env["PIPELINE_DATABASE_URL"] = url;
  const db = createPipelineDb();
  if (previous === undefined) delete process.env["PIPELINE_DATABASE_URL"];
  else process.env["PIPELINE_DATABASE_URL"] = previous;
  return { db, service: createPlaceService(db) };
}

const AUSTIN = {
  latitude: 30.2711286,
  longitude: -97.7436995,
  place_type: "city",
  display_name: "Austin, Travis County, Texas, United States",
  outline: { type: "Polygon", coordinates: [[[0, 0]]] },
};

describe("the place service", () => {
  let dir: string;
  let db: PipelineDb;
  let service: PlaceService;

  beforeAll(() => {
    const temp = createDb("pipeline-place-service-");
    dir = temp.dir;
    const built = buildService(temp.url);
    db = built.db;
    service = built.service;
  }, CREATE_TIMEOUT_MS);

  afterAll(async () => {
    await db.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  // Criterion 71. A run only pays for places it has never seen.
  test("a place not yet held is not found", async () => {
    expect(await service.findByText("Nowhere At All")).toBeNull();
  });

  // Criterion 72 and 105.
  test("a place that resolved is stored with everything it carries", async () => {
    await service.store("Austin", AUSTIN);
    expect(await service.findByText("Austin")).toEqual({
      lookup_text: "Austin",
      ...AUSTIN,
    });
  });

  // Criterion 94. Only an area can contain anything, so a place with no
  // outline is stored and the match falls back on distance.
  test("a place with no outline is stored all the same", async () => {
    await service.store("Sprinkle", { ...AUSTIN, outline: null });
    const place = await service.findByText("Sprinkle");
    expect(place?.outline).toBeNull();
  });

  // Criterion 73. What changes between runs is how locations are cut up
  // rather than the map, so an unreadable text is worth trying again.
  test("a place that resolved to nothing is not stored", async () => {
    await service.store("Bad Robot Games", null);
    expect(await service.findByText("Bad Robot Games")).toBeNull();
  });

  test("storing nothing writes no row at all", async () => {
    const before = await db.place.count();
    await service.store("Zilch UK", null);
    expect(await db.place.count()).toBe(before);
  });

  // A place met twice in one run costs one row, not two.
  test("storing the same text twice leaves one row", async () => {
    await service.store("Dallas", AUSTIN);
    await service.store("Dallas", AUSTIN);
    expect(await db.place.count({ where: { lookup_text: "Dallas" } })).toBe(1);
  });

  test("a place is found by the exact text that produced it", async () => {
    await service.store("Travis County", AUSTIN);
    expect(await service.findByText("travis county")).toBeNull();
  });
});
