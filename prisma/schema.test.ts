import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createClient } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createPipelineDb } from "../lib/db/pipeline-db";
import { DEDUPE_TRACE_REASONS } from "../lib/types/job-list-entry";

// This file lives in prisma/, so the repo root is one level up.
const prismaDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(prismaDir, "..");
const realSchemaPath = resolve(prismaDir, "schema.prisma");
const packageJsonPath = resolve(repoRoot, "package.json");
const devDbPath = resolve(repoRoot, "dev.db");

// Creating a database runs the prisma CLI in a child process. A run measured
// at well under a second, so these are ceilings rather than budgets.
// Raised from 45 seconds, which a full-suite run exceeded: vitest runs
// these child processes in parallel and they contend for the machine.
const CREATE_TIMEOUT_MS = 120_000;
const MULTI_CREATE_TIMEOUT_MS = 240_000;

const EXPECTED_JOB_COLUMNS = [
  "id",
  "company_id",
  "raw_company_name",
  "raw_company_slug",
  "raw_title",
  "title",
  "original_url",
  "original_url_match_key",
  "resolved_url",
  "resolved_url_match_key",
  "posting_date",
  "posting_updated_date",
  "created_at",
  "modified_at",
  "is_resolved",
  "is_parsed",
  "is_classified",
  "status",
  "raw_location_list",
  "normalized_location_list",
  "raw_mode_list",
  "normalized_mode_list",
  "collector",
  "raw_salary",
  "salary_low",
  "salary_high",
  "salary_period",
  "description",
  "collected_at",
  "parser",
  "location_match",
  "location_match_place",
  "location_match_mode",
  "is_repost",
  "alignment_score",
  "alignment_rationale",
];

// match_key holds the company name squashed down for matching, so two
// spellings of one employer reach one row. The four scores each carry their
// own rationale, because re-scoring one category writes one field: a single
// shared field would be overwritten with reasoning covering only what was
// researched this pass.
const EXPECTED_COMPANY_COLUMNS = [
  "id",
  "name",
  "match_key",
  "employee_satisfaction",
  "customer_satisfaction",
  "work_life_balance",
  "political_alignment",
  "employee_satisfaction_rationale",
  "customer_satisfaction_rationale",
  "work_life_balance_rationale",
  "political_alignment_rationale",
  "scored_at",
  "scores_guessed",
  "address",
  "phone",
  "website",
  "enriched_at",
  "enrichment_status",
  "enrichment_uncertain",
  "enrichment_flags",
  "created_at",
  "modified_at",
];

// The four judgements a company is scored on, each 1 to 5.
const COMPANY_SCORE_COLUMNS = [
  "employee_satisfaction",
  "customer_satisfaction",
  "work_life_balance",
  "political_alignment",
];

// The reasoning behind each score, one field per category.
const COMPANY_RATIONALE_COLUMNS = COMPANY_SCORE_COLUMNS.map((name) => `${name}_rationale`);

// One row per ATS board. The slug and the parser together record that a
// company posts on a hiring system; the collector records that we poll that
// board every run, and it stays empty until the company is promoted.
const EXPECTED_ATS_SLUG_COLUMNS = [
  "id",
  "slug",
  "company_id",
  "parser",
  "collector",
  "created_at",
  "modified_at",
];

// Setting is a single-row config table, not a key/value store. Json holds
// lists: search_terms and the vocabulary columns the title normalizer reads.
const EXPECTED_SETTING_COLUMNS = [
  "id",
  "search_terms",
  "location",
  "radius",
  "expiry_threshold",
  "title_head_nouns",
  "title_levels",
  "title_suffixes",
  "title_removal_words",
  "source_priority_list",
  "resolution_fast_concurrency",
  "resolution_slow_concurrency",
  "resolution_slow_pause_seconds",
  "repost_gap_days",
  "promotion_threshold",
  "score_expiry_days",
  "guessed_score_expiry_days",
  "created_at",
  "modified_at",
];

// One row per place the mapping service was asked about. lookup_text is the
// location fragment that was looked up, and the whole identity: a place is
// found again by the same text rather than by a name the service chose.
const EXPECTED_PLACE_COLUMNS = [
  "id",
  "lookup_text",
  "latitude",
  "longitude",
  "place_type",
  "display_name",
  "outline",
  "created_at",
];

// One row per event during a run. job_id names the job an event describes and
// company_id names the company, and neither carries a foreign key, so a row
// outlives whatever it was written for. A row names one or the other: a
// company score has no job and no collector behind it.
const EXPECTED_TRACE_COLUMNS = [
  "id",
  "run_id",
  "job_id",
  "company_id",
  "step",
  "event",
  "reason",
  "collector",
  "domain",
  "detail",
  "created_at",
];

// Every trace row carries these. Everything else is filled only by the events
// that have something to say — a job event names a job and a collector, a
// company event names a company instead.
const TRACE_REQUIRED_COLUMNS = ["run_id", "step", "event", "created_at"];
const TRACE_NULLABLE_COLUMNS = [
  "job_id",
  "company_id",
  "collector",
  "reason",
  "domain",
  "detail",
];

// Columns the pipeline writes on its way to save. A collector fills only what
// its source supplied and a later phase fills the rest, so every one of these
// must be nullable or carry a default.
const COLLECTOR_WRITTEN_COLUMNS = [
  "raw_company_name",
  "raw_company_slug",
  "raw_title",
  "title",
  "original_url",
  "resolved_url",
  "posting_date",
  "posting_updated_date",
  "raw_location_list",
  "raw_mode_list",
  "normalized_mode_list",
  "collector",
  "parser",
  "raw_salary",
  "salary_low",
  "salary_high",
  "salary_period",
  "description",
  "is_resolved",
  "is_parsed",
  "is_classified",
  "status",
];

// Columns the database fills itself. These are allowed to be required with no
// SQL default: Prisma supplies id and modified_at at write time.
const DATABASE_WRITTEN_COLUMNS = ["id", "created_at", "modified_at"];

// Written by the orchestrator on every entry before save runs, so it is
// required with no default: a row reaching the database without one would
// have no honest earliest sighting, and no default could supply one.
const ORCHESTRATOR_WRITTEN_COLUMNS = ["collected_at"];

interface ColumnInfo {
  name: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
  type: string;
}

// Runs the real create command against a scratch database. The url is passed
// through the environment because dotenv never overwrites a variable that is
// already set, so this value wins over the repo's .env and the real
// pipeline.db is never touched.
function runDbCreate(url: string): void {
  execFileSync("npx", ["tsx", "scripts/db-create.ts"], {
    cwd: repoRoot,
    env: { ...process.env, PIPELINE_DATABASE_URL: url },
    stdio: "pipe",
  });
}

// Pushes a named schema file, used only to stand up a deliberately different
// schema before recreating the real one.
function pushSchema(schemaPath: string, url: string): void {
  execFileSync("npx", ["prisma", "db", "push", "--schema", schemaPath], {
    cwd: repoRoot,
    env: { ...process.env, PIPELINE_DATABASE_URL: url },
    stdio: "pipe",
  });
}

// Reads a table's columns out of sqlite rather than parsing the schema text,
// so the assertions check what actually landed in the database. An absent
// table yields an empty list.
async function tableColumns(url: string, table: string): Promise<ColumnInfo[]> {
  const client = createClient({ url });
  try {
    const result = await client.execute(`PRAGMA table_info(${table})`);
    return result.rows.map((row) => {
      const record = row as unknown as Record<string, unknown>;
      return {
        name: String(record["name"]),
        notnull: Number(record["notnull"]),
        dflt_value: record["dflt_value"],
        pk: Number(record["pk"]),
        type: String(record["type"]),
      };
    });
  } finally {
    client.close();
  }
}

async function columnNames(url: string, table: string): Promise<string[]> {
  const columns = await tableColumns(url, table);
  return columns.map((column) => column.name).sort();
}

interface IndexInfo {
  name: string;
  unique: boolean;
  columns: string[];
}

// Asks sqlite which indexes a table carries and which columns each one covers,
// so an assertion checks what actually landed rather than the name Prisma
// happened to give it.
async function tableIndexes(url: string, table: string): Promise<IndexInfo[]> {
  const client = createClient({ url });
  try {
    const list = await client.execute(`PRAGMA index_list(${table})`);
    const indexes: IndexInfo[] = [];
    for (const row of list.rows) {
      const record = row as unknown as Record<string, unknown>;
      const name = String(record["name"]);
      const info = await client.execute(`PRAGMA index_info("${name}")`);
      indexes.push({
        name,
        unique: Number(record["unique"]) === 1,
        columns: info.rows.map((each) =>
          String((each as unknown as Record<string, unknown>)["name"])
        ),
      });
    }
    return indexes;
  } finally {
    client.close();
  }
}

// Every index covering exactly the one named column, which is the shape both
// match-key indexes take.
async function indexesCovering(url: string, table: string, column: string): Promise<IndexInfo[]> {
  const indexes = await tableIndexes(url, table);
  return indexes.filter((index) => index.columns.length === 1 && index.columns[0] === column);
}

async function countRows(url: string, table: string): Promise<number> {
  const client = createClient({ url });
  try {
    const result = await client.execute(`SELECT count(*) as count FROM ${table}`);
    const record = result.rows[0] as unknown as Record<string, unknown>;
    return Number(record["count"]);
  } finally {
    client.close();
  }
}

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

// An absolute url, because a relative Prisma url resolves from the directory
// holding prisma.config.ts rather than from the working directory.
function makeTempDb(prefix: string): { dir: string; url: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, url: `file:${join(dir, "pipeline.db")}` };
}

describe("AC4: the create command builds every table collection needs", () => {
  let dir: string;
  let url: string;

  beforeAll(() => {
    const temp = makeTempDb("pipeline-schema-ac4-");
    dir = temp.dir;
    url = temp.url;
    runDbCreate(url);
  }, CREATE_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("db:create is registered in package.json", () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.["db:create"]).toMatch(/scripts\/db-create\.ts/);
  });

  test("creates the Job table", async () => {
    expect(await columnNames(url, "Job")).not.toEqual([]);
  });

  test("creates the Company table", async () => {
    expect(await columnNames(url, "Company")).not.toEqual([]);
  });

  test("creates the Setting table", async () => {
    expect(await columnNames(url, "Setting")).not.toEqual([]);
  });

  test("creates the Trace table", async () => {
    expect(await columnNames(url, "Trace")).not.toEqual([]);
  });

  test("creates the Place table", async () => {
    expect(await columnNames(url, "Place")).not.toEqual([]);
  });

  // Every other test hands the url to the command directly. Running it the way
  // a user does means the url comes from .env instead, so the command has to
  // load .env itself.
  test("reads the database url from .env when it is absent from the environment", async () => {
    const temp = makeTempDb("pipeline-schema-dotenv-");
    const envPath = join(temp.dir, ".env");
    writeFileSync(envPath, `PIPELINE_DATABASE_URL="${temp.url}"\n`);

    const childEnv: NodeJS.ProcessEnv = { ...process.env, DOTENV_CONFIG_PATH: envPath };
    delete childEnv["PIPELINE_DATABASE_URL"];
    execFileSync("npx", ["tsx", "scripts/db-create.ts"], {
      cwd: repoRoot,
      env: childEnv,
      stdio: "pipe",
    });

    try {
      expect(await columnNames(temp.url, "Job")).not.toEqual([]);
    } finally {
      rmSync(temp.dir, { recursive: true, force: true });
    }
  }, CREATE_TIMEOUT_MS);
});

describe("AC5: recreating after a schema change matches the new schema", () => {
  // Hashed before any command runs, so the closing comparison proves this
  // suite never reached the database real job searches depend on.
  const devDbExisted = existsSync(devDbPath);
  const devDbHashBefore = devDbExisted ? hashFile(devDbPath) : undefined;

  let dir: string;
  let url: string;
  let extraTableBeforeRecreate: string[];

  beforeAll(async () => {
    const temp = makeTempDb("pipeline-schema-ac5-");
    dir = temp.dir;
    url = temp.url;

    // Stand up the real schema and give it data to lose.
    runDbCreate(url);
    const client = createClient({ url });
    try {
      await client.execute({
        sql:
          "INSERT INTO Setting (id, search_terms, location, radius, expiry_threshold, created_at, modified_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?)",
        args: [
          1,
          JSON.stringify(["ux designer"]),
          "Austin",
          15,
          8,
          "2026-01-01T00:00:00.000Z",
          "2026-01-01T00:00:00.000Z",
        ],
      });
    } finally {
      client.close();
    }

    // Change the schema: the real one plus a table that does not belong to it.
    // The generated client is redirected into the temp directory so the push
    // leaves nothing behind in the repo.
    const modifiedSchemaPath = join(dir, "modified.prisma");
    const modifiedSchema =
      readFileSync(realSchemaPath, "utf-8").replace(
        /output\s*=\s*"[^"]*"/,
        'output = "./generated/schema-test"'
      ) + "\nmodel OnlyInTheModifiedSchema {\n  id Int @id @default(autoincrement())\n}\n";
    writeFileSync(modifiedSchemaPath, modifiedSchema);
    pushSchema(modifiedSchemaPath, url);
    extraTableBeforeRecreate = await columnNames(url, "OnlyInTheModifiedSchema");

    // Recreate from the real schema.
    runDbCreate(url);
  }, MULTI_CREATE_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("the changed schema genuinely added a table", () => {
    expect(extraTableBeforeRecreate).not.toEqual([]);
  });

  test("recreating drops a table the real schema does not declare", async () => {
    expect(await columnNames(url, "OnlyInTheModifiedSchema")).toEqual([]);
  });

  test("recreating clears data the previous database held", async () => {
    expect(await countRows(url, "Setting")).toBe(0);
  });

  test("Job matches the real schema after recreating", async () => {
    expect(await columnNames(url, "Job")).toEqual([...EXPECTED_JOB_COLUMNS].sort());
  });

  test("Company matches the real schema after recreating", async () => {
    expect(await columnNames(url, "Company")).toEqual([...EXPECTED_COMPANY_COLUMNS].sort());
  });

  test("Setting matches the real schema after recreating", async () => {
    expect(await columnNames(url, "Setting")).toEqual([...EXPECTED_SETTING_COLUMNS].sort());
  });

  test("Trace matches the real schema after recreating", async () => {
    expect(await columnNames(url, "Trace")).toEqual([...EXPECTED_TRACE_COLUMNS].sort());
  });

  test("Place holds exactly the columns a looked-up place needs", async () => {
    expect(await columnNames(url, "Place")).toEqual([...EXPECTED_PLACE_COLUMNS].sort());
  });

  test.skipIf(!devDbExisted)("dev.db is byte-for-byte unchanged", () => {
    expect(hashFile(devDbPath)).toBe(devDbHashBefore);
  });
});

describe("AC17: no collector-written field is required without a default", () => {
  let dir: string;
  let jobColumns: ColumnInfo[];

  beforeAll(async () => {
    const temp = makeTempDb("pipeline-schema-ac17-");
    dir = temp.dir;
    runDbCreate(temp.url);
    jobColumns = await tableColumns(temp.url, "Job");
  }, CREATE_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.each(COLLECTOR_WRITTEN_COLUMNS)("%s is nullable or has a default", (name) => {
    const column = jobColumns.find((candidate) => candidate.name === name);
    expect(column, `Job has no column named ${name}`).toBeDefined();
    const nullable = column?.notnull === 0;
    const hasDefault = column?.dflt_value !== null && column?.dflt_value !== undefined;
    expect(nullable || hasDefault).toBe(true);
  });

  test("only the database-written and orchestrator-written columns are required without a default", async () => {
    const allowed = [...DATABASE_WRITTEN_COLUMNS, ...ORCHESTRATOR_WRITTEN_COLUMNS];
    const offenders = jobColumns.filter(
      (column) =>
        !allowed.includes(column.name) &&
        column.notnull === 1 &&
        (column.dflt_value === null || column.dflt_value === undefined)
    );
    expect(offenders.map((column) => column.name)).toEqual([]);
  });
});

describe("AC26: a job list entry maps one to one onto the Job row", () => {
  let dir: string;
  let url: string;

  beforeAll(() => {
    const temp = makeTempDb("pipeline-schema-ac26-");
    dir = temp.dir;
    url = temp.url;
    runDbCreate(url);
  }, CREATE_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("Job holds exactly the fields a job list entry carries", async () => {
    expect(await columnNames(url, "Job")).toEqual([...EXPECTED_JOB_COLUMNS].sort());
  });

  test("delete_on_save is not a column", async () => {
    expect(await columnNames(url, "Job")).not.toContain("delete_on_save");
  });

  test("Company holds exactly the fields collection needs", async () => {
    expect(await columnNames(url, "Company")).toEqual([...EXPECTED_COMPANY_COLUMNS].sort());
  });

  test("Setting holds exactly the settings collection needs", async () => {
    expect(await columnNames(url, "Setting")).toEqual([...EXPECTED_SETTING_COLUMNS].sort());
  });

  test("Trace holds exactly the fields tracing needs", async () => {
    expect(await columnNames(url, "Trace")).toEqual([...EXPECTED_TRACE_COLUMNS].sort());
  });

  test("Place holds exactly the columns a looked-up place needs", async () => {
    expect(await columnNames(url, "Place")).toEqual([...EXPECTED_PLACE_COLUMNS].sort());
  });

  test("the schema declares no @map, so field names match column names", () => {
    expect(readFileSync(realSchemaPath, "utf-8")).not.toMatch(/@@?map\(/);
  });

  test("every column across the four tables is snake_case", async () => {
    const names = [
      ...(await columnNames(url, "Job")),
      ...(await columnNames(url, "Company")),
      ...(await columnNames(url, "Setting")),
      ...(await columnNames(url, "Trace")),
    ];
    for (const name of names) {
      expect(name).toMatch(/^[a-z0-9_]+$/);
    }
  });
});

describe("Trace: required and nullable columns match the spec", () => {
  let dir: string;
  let traceColumns: ColumnInfo[];

  beforeAll(async () => {
    const temp = makeTempDb("pipeline-schema-trace-nullability-");
    dir = temp.dir;
    runDbCreate(temp.url);
    traceColumns = await tableColumns(temp.url, "Trace");
  }, CREATE_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.each(TRACE_REQUIRED_COLUMNS)("%s is required", (name) => {
    const column = traceColumns.find((candidate) => candidate.name === name);
    expect(column, `Trace has no column named ${name}`).toBeDefined();
    expect(column?.notnull).toBe(1);
  });

  test.each(TRACE_NULLABLE_COLUMNS)("%s is nullable", (name) => {
    const column = traceColumns.find((candidate) => candidate.name === name);
    expect(column, `Trace has no column named ${name}`).toBeDefined();
    expect(column?.notnull).toBe(0);
  });
});

describe("Trace: its id orders events, and it outlives the job it describes", () => {
  let dir: string;
  let url: string;

  beforeAll(() => {
    const temp = makeTempDb("pipeline-schema-trace-shape-");
    dir = temp.dir;
    url = temp.url;
    runDbCreate(url);
  }, CREATE_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("id is an integer primary key", async () => {
    const columns = await tableColumns(url, "Trace");
    const id = columns.find((column) => column.name === "id");
    expect(id, "Trace has no id column").toBeDefined();
    expect(id?.pk).toBe(1);
    expect(id?.type.toUpperCase()).toBe("INTEGER");
  });

  test("a row written with no id supplied gets one anyway", async () => {
    const client = createClient({ url });
    try {
      await client.execute({
        sql:
          "INSERT INTO Trace (run_id, job_id, step, event, collector, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?)",
        args: ["run-1", "job-1", "collection", "job_collected", "adzuna", "2026-01-01T00:00:00.000Z"],
      });
      const result = await client.execute("SELECT id FROM Trace");
      const row = result.rows[0] as unknown as Record<string, unknown>;
      expect(Number(row["id"])).toBeGreaterThan(0);
    } finally {
      client.close();
    }
  });

  test("the second row written gets a higher id than the first", async () => {
    const client = createClient({ url });
    try {
      // The id is read straight after each insert rather than by timestamp,
      // because two events landing in the same millisecond is exactly the case
      // this id exists to survive.
      const insertAndReadId = async (): Promise<number> => {
        await client.execute({
          sql:
            "INSERT INTO Trace (run_id, job_id, step, event, collector, created_at) " +
            "VALUES (?, ?, ?, ?, ?, ?)",
          args: ["run-1", "job-1", "collection", "job_collected", "adzuna", "2026-01-01T00:00:00.000Z"],
        });
        const result = await client.execute("SELECT last_insert_rowid() as id");
        return Number((result.rows[0] as unknown as Record<string, unknown>)["id"]);
      };

      const firstId = await insertAndReadId();
      const secondId = await insertAndReadId();
      expect(secondId).toBeGreaterThan(firstId);
    } finally {
      client.close();
    }
  });

  test("job_id carries no foreign key to Job", async () => {
    const client = createClient({ url });
    try {
      const result = await client.execute("PRAGMA foreign_key_list(Trace)");
      expect(result.rows).toEqual([]);
    } finally {
      client.close();
    }
  });

  test("deleting the job leaves its trace row in place", async () => {
    const client = createClient({ url });
    try {
      const timestamp = "2026-01-01T00:00:00.000Z";
      // collected_at carries no database default, so a raw insert has to
      // supply it, the same way Company's modified_at does.
      await client.execute({
        sql: "INSERT INTO Job (id, created_at, modified_at, collected_at) VALUES (?, ?, ?, ?)",
        args: ["job-to-delete", timestamp, timestamp, timestamp],
      });
      await client.execute({
        sql:
          "INSERT INTO Trace (run_id, job_id, step, event, collector, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?)",
        args: ["run-1", "job-to-delete", "collection", "job_collected", "adzuna", timestamp],
      });
      await client.execute({ sql: "DELETE FROM Job WHERE id = ?", args: ["job-to-delete"] });

      const result = await client.execute({
        sql: "SELECT job_id FROM Trace WHERE job_id = ?",
        args: ["job-to-delete"],
      });
      expect(result.rows.length).toBe(1);
    } finally {
      client.close();
    }
  });
});

describe("Trace: the model comment carries both vocabularies", () => {
  // Only the comment sitting directly above the model counts, because the
  // words it holds also appear elsewhere in the schema.
  function traceComment(): string {
    const schema = readFileSync(realSchemaPath, "utf-8");
    const match = schema.match(/((?:\/\/[^\n]*\n)+)model Trace \{/);
    expect(match, "Trace model not found in schema.prisma").toBeTruthy();
    return match?.[1] ?? "";
  }

  test("the step vocabulary is listed in pipeline order", () => {
    const steps = [
      "backlog_cleanup",
      "post_backlog_cleanup_save",
      "collection",
      "post_collection_normalization",
      "post_collection_association",
      "post_collection_dedupe",
      "post_collection_save",
      "resolution",
      "post_resolution_dedupe",
      "post_resolution_save",
      "parsing",
      "post_parsing_normalization",
      "post_parsing_association",
      "post_parsing_dedupe",
      "post_parsing_save",
      "promotion",
      "post_promotion_save",
      "classification",
      "post_classification_save",
      "scoring",
      "company_promotion",
    ];
    const comment = traceComment();
    let searchFrom = 0;
    for (const step of steps) {
      const index = comment.indexOf(step, searchFrom);
      expect(index, `${step} is missing or out of pipeline order`).toBeGreaterThanOrEqual(0);
      searchFrom = index + step.length;
    }
  });

  test("collection's reason codes are listed", () => {
    const comment = traceComment();
    const reasons = [
      "no_original_url",
      "original_url_not_a_url",
      "no_raw_title",
      "no_company_identity",
      "posting_date_unparseable",
      "posting_updated_date_unparseable",
    ];
    for (const reason of reasons) {
      expect(comment).toContain(reason);
    }
  });

  test("normalization's reason codes are listed", () => {
    // None of these nine names is a substring of another: every
    // *_normalized name is followed by a suffix that a longer sibling
    // spells differently right after the shared field prefix (title_
    // then "normalized" vs. "not_normalized", salary_ and work_mode_
    // then "normalized" vs. "partially_normalized"), so a toContain here
    // cannot pass on the strength of the wrong reason.
    const comment = traceComment();
    const reasons = [
      "title_normalized",
      "missing_role_noun",
      "salary_normalized",
      "salary_partially_normalized",
      "salary_unusable",
      "work_mode_normalized",
      "work_mode_partially_normalized",
      "work_mode_unusable",
      "company_name_normalized",
      // The tenth, added with locations. It is not a substring of any name
      // above: work_mode_unusable and salary_unusable both spell a different
      // field before the shared _unusable suffix.
      "location_unusable",
    ];
    for (const reason of reasons) {
      expect(comment).toContain(reason);
    }
  });

  test("association's reason codes are listed", () => {
    // None of these six is a substring of a reason already in the comment:
    // company_name_filled and company_name_clash both diverge from
    // company_name_normalized straight after the shared company_name_ prefix.
    const comment = traceComment();
    const reasons = [
      "matched_by_slug",
      "matched_by_name",
      "company_created",
      "company_name_filled",
      "no_company_name",
      "company_name_clash",
    ];
    for (const reason of reasons) {
      expect(comment).toContain(reason);
    }
  });

  test("the event vocabulary is listed", () => {
    // company_updated is not a substring of company_update_failed, which
    // spells an underscore where the shorter name spells its final d, so
    // neither can pass on the strength of the other.
    const comment = traceComment();
    const events = [
      "job_collected",
      "job_abandoned",
      "job_updated",
      "normalization_failed",
      "company_associated",
      "company_dbrow_updated",
      "association_failed",
      "company_update_failed",
    ];
    for (const event of events) {
      expect(comment).toContain(event);
    }
  });

  test("save's events are listed", () => {
    // job_dbrow_updated is not a substring of job_dbrow_status_updated: the
    // two diverge straight after the shared job_dbrow_ prefix, so neither can
    // pass on the strength of the other.
    const comment = traceComment();
    const events = [
      "job_dbrow_created",
      "job_dbrow_updated",
      "job_dbrow_status_updated",
      "job_dbrow_deleted",
      // Save's fifth event is collection's job_abandoned, reused rather than
      // renamed, so the step and the reason are what tell the two apart.
      "job_abandoned",
    ];
    for (const event of events) {
      expect(comment).toContain(event);
    }
  });

  test("save's reason code is listed", () => {
    expect(traceComment()).toContain("db_write_failed");
  });

  test("dedupe's events are listed", () => {
    // job_dbrow_delete_refused is not a substring of job_dbrow_deleted and
    // job_dbrow_deleted is not a substring of it: the two diverge straight
    // after the shared job_dbrow_delete prefix, so neither can pass on the
    // strength of the other.
    const comment = traceComment();
    const events = [
      "job_added_to_list",
      "job_dbrow_delete_refused",
      // Dedupe's other three rows reuse names already in the comment, so the
      // reasons below are what tell its populations from save's and
      // collection's.
      "job_abandoned",
      "job_dbrow_deleted",
    ];
    for (const event of events) {
      expect(comment).toContain(event);
    }
  });

  test("the judging steps' events are listed", () => {
    // job_expired is not a substring of any other name here, and is the one
    // event two of the three steps share — backlog cleanup and classification
    // both write it, and step is what tells the two populations apart.
    const comment = traceComment();
    const events = [
      "job_entered",
      "job_kept",
      "job_expired",
      "job_promoted",
      "job_reposted",
      "job_classified",
      "classification_failed",
    ];
    for (const event of events) {
      expect(comment).toContain(event);
    }
  });

  test("the company events every step writes are listed", () => {
    // A company's path is its own, and every row on it names a company and
    // never a job. None of these is a substring of another: company_scored
    // and company_scores_cleared diverge straight after company_score, and
    // company_partially_scored spells the stem second rather than first.
    const comment = traceComment();
    const events = [
      "company_entered",
      "company_kept",
      "company_scores_cleared",
      "placeholder_company_scores_cleared",
      "company_dbrow_updated",
      "company_scored",
      "company_partially_scored",
      "company_scoring_failed",
      "company_promoted",
      "company_promotion_skipped",
    ];
    for (const event of events) {
      expect(comment).toContain(event);
    }
  });

  test("scoring's own events are listed", () => {
    const comment = traceComment();
    for (const event of ["job_scored", "scoring_failed"]) {
      expect(comment).toContain(event);
    }
  });

  test("the company reason codes are listed", () => {
    // Six reasons across backlog cleanup, scoring and promotion. Both
    // clearings now share past_expiration_threshold and are told apart by
    // their event, so one word covers every expiry the pipeline records. None
    // of the six is a substring of another, and the four promotion reasons
    // share no stem at all.
    const comment = traceComment();
    const reasons = [
      "past_expiration_threshold",
      "insufficient_research",
      "no_company_name",
      "not_fully_scored",
      "below_promotion_threshold",
      "no_pollable_board",
      "already_polled",
    ];
    for (const reason of reasons) {
      expect(comment).toContain(reason);
    }
  });

  test("scoring's job reason codes are listed", () => {
    const comment = traceComment();
    for (const reason of ["no_posting_url", "posting_unreadable", "scoring_agent_failed"]) {
      expect(comment).toContain(reason);
    }
  });

  test("the judging steps' reason codes are listed", () => {
    // Classification shares location_unusable with normalization, and
    // past_expiration_threshold with backlog cleanup; the event is what tells
    // each pair of populations apart. no_location_match spells the location
    // stem second rather than first, so it is a substring of neither.
    const comment = traceComment();
    const reasons = ["past_expiration_threshold", "no_location_match", "location_unusable"];
    for (const reason of reasons) {
      expect(comment).toContain(reason);
    }
  });

  test("dedupe's reason codes are listed", () => {
    // Read from the code rather than retyped here, so adding a reason there
    // and forgetting this comment fails the build. None of the four is a
    // substring of another or of a reason already in the comment:
    // hard_match_in_list and repost_match_in_list differ from their first
    // character, and matched_db_row and matched_list_entry diverge straight
    // after the shared matched_ prefix.
    const comment = traceComment();
    for (const reason of DEDUPE_TRACE_REASONS) {
      expect(comment).toContain(reason);
    }
  });

  test("the comment's own count of dedupe's reasons matches the code", () => {
    // The comment opens dedupe's section by saying how many reasons follow.
    // Checking that number against the list catches the drift the loop above
    // cannot see: a reason written into the comment and never added to the
    // code leaves the count wrong here.
    const countWords = ["", "one", "two", "three", "four", "five", "six"];
    const word = countWords[DEDUPE_TRACE_REASONS.length];

    expect(word).toBeDefined();
    expect(traceComment()).toContain(`Dedupe writes ${word}.`);
  });

  // AC 66. Resolution writes two events of its own and reuses collection's
  // job_abandoned for a job its resolution disqualified.
  test("resolution's events are listed", () => {
    const comment = traceComment();
    const events = [
      "job_resolved",
      "resolution_failed",
      // Resolution's third event is collection's job_abandoned, reused rather
      // than renamed, so the step and the reason are what tell the
      // populations apart.
      "job_abandoned",
    ];
    for (const event of events) {
      expect(comment).toContain(event);
    }
  });

  test("resolution's reason codes are listed", () => {
    // None of these is a substring of another or of a reason already in the
    // comment. page_limit_reached is the one that sits on two events, which is
    // what lets a single query count how often four pages is the binding
    // constraint.
    const comment = traceComment();
    const reasons = [
      "no_apply_links",
      "link_left_site",
      "stayed_on_site",
      "page_limit_reached",
      "dead_end",
      "page_unavailable",
      "page_refused",
      "page_load_failed",
      "blacklisted_url",
      "posting_gone",
      "collector_provided",
    ];
    for (const reason of reasons) {
      expect(comment).toContain(reason);
    }
  });

  // Parsing writes two events of its own. It reuses nothing, because reading a
  // posting is not something any earlier step does.
  test("parsing's events are listed", () => {
    const comment = traceComment();
    for (const event of ["job_parsed", "parsing_failed"]) {
      expect(comment).toContain(event);
    }
  });

  test("parsing's reason codes are listed", () => {
    // None of the three is a substring of another or of a reason already in
    // the comment. no_parser_for_domain shares no prefix with collection's
    // no_original_url beyond the no_ every dead end starts with.
    const comment = traceComment();
    const reasons = ["no_parser_for_domain", "parser_errored", "nothing_parsed"];
    for (const reason of reasons) {
      expect(comment).toContain(reason);
    }
  });

  // AC 67's schema half. A job merged away takes job_abandoned whether or not it
  // held a row, so the comment may no longer tie the word to a row's absence.
  test("the comment ties job_abandoned to the path ending rather than to a missing row", () => {
    const comment = traceComment();
    const collapsed = comment.replace(/\/\//g, " ").replace(/\s+/g, " ").trim();

    expect(collapsed).toContain(
      "job_abandoned ends a job's path through the pipeline and makes no claim about whether a row existed"
    );
  });

  test("the comment states that normalization_failed still writes a fallback value", () => {
    // The sentence is hard-wrapped across several "//"-prefixed lines, so a
    // toContain on the full sentence would fail even with every word
    // present. Stripping the "//" markers and then collapsing every run of
    // whitespace (line breaks included) down to a single space reassembles
    // it into one line before matching.
    const comment = traceComment();
    const collapsed = comment.replace(/\/\//g, " ").replace(/\s+/g, " ").trim();
    expect(collapsed).toContain(
      "normalization_failed does not mean nothing was written. A title that matched no job noun still stores its cleaned fallback, so missing_role_noun records that the rule found nothing to fire on rather than that the field was left empty."
    );
  });
});

describe("Company: name is optional and match_key is unique", () => {
  let dir: string;
  let url: string;
  let companyColumns: ColumnInfo[];
  let uniqueColumns: Set<string>;

  const INSERT_COMPANY =
    "INSERT INTO Company (id, name, match_key, created_at, modified_at) VALUES (?, ?, ?, ?, ?)";
  // modified_at carries no SQL default, so a raw insert has to supply it.
  const WRITTEN_AT = "2026-01-01T00:00:00.000Z";

  // Sqlite records a unique column as a unique index rather than a column
  // flag, so finding one means reading through the index list and reading which
  // columns each index covers.
  async function uniqueColumnNames(dbUrl: string, table: string): Promise<Set<string>> {
    const client = createClient({ url: dbUrl });
    try {
      const indexList = await client.execute(`PRAGMA index_list(${table})`);
      const names = new Set<string>();
      for (const row of indexList.rows) {
        const record = row as unknown as Record<string, unknown>;
        if (Number(record["unique"]) !== 1) continue;
        const indexInfo = await client.execute(`PRAGMA index_info(${String(record["name"])})`);
        for (const infoRow of indexInfo.rows) {
          const infoRecord = infoRow as unknown as Record<string, unknown>;
          names.add(String(infoRecord["name"]));
        }
      }
      return names;
    } finally {
      client.close();
    }
  }

  // One scratch database serves every test here. Building one runs the prisma
  // CLI in a child process, which is the slow part.
  beforeAll(async () => {
    const temp = makeTempDb("pipeline-schema-company-identity-");
    dir = temp.dir;
    url = temp.url;
    runDbCreate(url);
    companyColumns = await tableColumns(url, "Company");
    uniqueColumns = await uniqueColumnNames(url, "Company");
  }, CREATE_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("name is nullable", () => {
    const name = companyColumns.find((column) => column.name === "name");
    expect(name, "Company has no name column").toBeDefined();
    expect(name?.notnull).toBe(0);
  });

  test("match_key is unique", () => {
    expect(uniqueColumns.has("match_key")).toBe(true);
  });

  test("a second company carrying a match key already in use is refused", async () => {
    const client = createClient({ url });
    try {
      await client.execute({
        sql: INSERT_COMPANY,
        args: ["company-key-1", "Acme Inc", "acme", WRITTEN_AT, WRITTEN_AT],
      });
      await expect(
        client.execute({
          sql: INSERT_COMPANY,
          args: ["company-key-2", "Acme Incorporated", "acme", WRITTEN_AT, WRITTEN_AT],
        })
      ).rejects.toThrow();
    } finally {
      client.close();
    }
  });

  // A company met only as a board slug has no name and no match key, so two
  // of them occupy neither unique column. The seed creates one per board, so
  // this has to hold.
  test("two companies carrying neither a name nor a match key both save", async () => {
    const client = createClient({ url });
    try {
      for (const id of ["nameless-1", "nameless-2"]) {
        await client.execute({
          sql: INSERT_COMPANY,
          args: [id, null, null, WRITTEN_AT, WRITTEN_AT],
        });
      }
      const result = await client.execute(
        "SELECT count(*) as count FROM Company WHERE name IS NULL"
      );
      const record = result.rows[0] as unknown as Record<string, unknown>;
      expect(Number(record["count"])).toBe(2);
    } finally {
      client.close();
    }
  });
});

// How well one job fits the user, judged by an agent against the alignment
// rubric, with the reasoning beside it. One rationale field rather than four,
// because alignment is one score.
describe("Job: the alignment score and the reasoning behind it", () => {
  let dir: string;
  let jobColumns: ColumnInfo[];

  beforeAll(async () => {
    const temp = makeTempDb("pipeline-schema-alignment-");
    dir = temp.dir;
    runDbCreate(temp.url);
    jobColumns = await tableColumns(temp.url, "Job");
  }, CREATE_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function findColumn(name: string): ColumnInfo | undefined {
    const column = jobColumns.find((candidate) => candidate.name === name);
    expect(column, `Job has no column named ${name}`).toBeDefined();
    return column;
  }

  test("alignment_score is a whole number", () => {
    expect(String(findColumn("alignment_score")?.type).toUpperCase()).toBe("INTEGER");
  });

  // A job reads as needing scoring exactly when this is empty, so the column
  // has to be allowed to be empty and must carry no default.
  test("alignment_score is optional", () => {
    expect(findColumn("alignment_score")?.notnull).toBe(0);
  });

  test("alignment_score carries no default", () => {
    expect(findColumn("alignment_score")?.dflt_value ?? null).toBeNull();
  });

  test("alignment_rationale is an optional string", () => {
    expect(String(findColumn("alignment_rationale")?.type).toUpperCase()).toBe("TEXT");
    expect(findColumn("alignment_rationale")?.notnull).toBe(0);
  });
});

// A company is judged on four things, and each judgement carries its own
// reasoning. scored_at dates all four together, and scores_guessed names the
// ones the agent guessed at because nothing public existed.
describe("Company: the four scores, their reasoning, and when they were given", () => {
  let dir: string;
  let companyColumns: ColumnInfo[];

  beforeAll(async () => {
    const temp = makeTempDb("pipeline-schema-company-scores-");
    dir = temp.dir;
    runDbCreate(temp.url);
    companyColumns = await tableColumns(temp.url, "Company");
  }, CREATE_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function findColumn(name: string): ColumnInfo | undefined {
    const column = companyColumns.find((candidate) => candidate.name === name);
    expect(column, `Company has no column named ${name}`).toBeDefined();
    return column;
  }

  // A new column's type is compared against a column of the same Prisma type
  // already in the schema rather than against a literal, so the assertion does
  // not hardcode how Prisma spells a type in sqlite today.
  function typeOf(columns: ColumnInfo[], name: string): string {
    return String(columns.find((candidate) => candidate.name === name)?.type).toUpperCase();
  }

  test.each(COMPANY_SCORE_COLUMNS)("%s is a whole number", (name) => {
    expect(typeOf(companyColumns, name)).toBe("INTEGER");
  });

  // A company reads as needing research exactly when a score is missing, so
  // every one of these has to be allowed to be empty.
  test.each(COMPANY_SCORE_COLUMNS)("%s is optional", (name) => {
    expect(findColumn(name)?.notnull).toBe(0);
  });

  test.each(COMPANY_RATIONALE_COLUMNS)("%s is an optional string", (name) => {
    expect(typeOf(companyColumns, name)).toBe("TEXT");
    expect(findColumn(name)?.notnull).toBe(0);
  });

  test("scored_at is an optional date", () => {
    expect(typeOf(companyColumns, "scored_at")).toBe(typeOf(companyColumns, "created_at"));
    expect(findColumn("scored_at")?.notnull).toBe(0);
  });

  // A list of category names, so it holds whichever of the four were guessed.
  test("scores_guessed is an optional list", () => {
    expect(findColumn("scores_guessed")?.notnull).toBe(0);
  });

  test("no score carries a default, so an unscored company reads as empty", () => {
    for (const name of [...COMPANY_SCORE_COLUMNS, "scored_at", "scores_guessed"]) {
      expect(findColumn(name)?.dflt_value ?? null).toBeNull();
    }
  });
});

// The board lists used to be a pair of columns on the company record, which
// forced two different facts to travel together: that a company posts on a
// hiring system, and that we poll its board every run. A table of its own
// separates them, because the collector is what says we poll.
describe("AtsSlug: one row per board, the slug unique and the collector optional", () => {
  let dir: string;
  let url: string;
  let slugColumns: ColumnInfo[];

  // modified_at carries no SQL default, so a raw insert has to supply it.
  const WRITTEN_AT = "2026-01-01T00:00:00.000Z";
  const INSERT_SLUG =
    "INSERT INTO AtsSlug (id, slug, company_id, parser, collector, created_at, modified_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?)";

  // A slug row names a company, so one has to exist before any row can point
  // at it.
  async function insertCompany(client: ReturnType<typeof createClient>, id: string): Promise<void> {
    await client.execute({
      sql: "INSERT INTO Company (id, name, match_key, created_at, modified_at) VALUES (?, ?, ?, ?, ?)",
      args: [id, id, id, WRITTEN_AT, WRITTEN_AT],
    });
  }

  beforeAll(async () => {
    const temp = makeTempDb("pipeline-schema-ats-slug-");
    dir = temp.dir;
    url = temp.url;
    runDbCreate(url);
    slugColumns = await tableColumns(url, "AtsSlug");
  }, CREATE_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("the table holds exactly the columns a board row needs", async () => {
    expect(await columnNames(url, "AtsSlug")).toEqual([...EXPECTED_ATS_SLUG_COLUMNS].sort());
  });

  test("every column is snake_case", () => {
    for (const column of slugColumns) {
      expect(column.name).toMatch(/^[a-z0-9_]+$/);
    }
  });

  test("slug is required", () => {
    expect(slugColumns.find((column) => column.name === "slug")?.notnull).toBe(1);
  });

  test("company_id is required", () => {
    expect(slugColumns.find((column) => column.name === "company_id")?.notnull).toBe(1);
  });

  test("parser is required", () => {
    expect(slugColumns.find((column) => column.name === "parser")?.notnull).toBe(1);
  });

  // Company matching writes the row before anything decides to poll the board,
  // so a row with no collector is the normal case rather than an incomplete one.
  test("collector is optional", () => {
    expect(slugColumns.find((column) => column.name === "collector")?.notnull).toBe(0);
  });

  test("the row names the company it belongs to", async () => {
    const client = createClient({ url });
    try {
      const keys = await client.execute("PRAGMA foreign_key_list(AtsSlug)");
      const targets = keys.rows.map((row) => {
        const record = row as unknown as Record<string, unknown>;
        return String(record["table"]);
      });
      expect(targets).toContain("Company");
    } finally {
      client.close();
    }
  });

  test("a row written with no collector saves", async () => {
    const client = createClient({ url });
    try {
      await insertCompany(client, "ats-slug-company-a");
      await client.execute({
        sql: INSERT_SLUG,
        args: [
          "ats-slug-row-a",
          "unpolled-board",
          "ats-slug-company-a",
          "greenhouse",
          null,
          WRITTEN_AT,
          WRITTEN_AT,
        ],
      });
      const result = await client.execute({
        sql: "SELECT collector FROM AtsSlug WHERE slug = ?",
        args: ["unpolled-board"],
      });
      expect(result.rows.length).toBe(1);
    } finally {
      client.close();
    }
  });

  // A job carries a slug without carrying which board it came from, so a slug
  // held by two rows could not be resolved to one company.
  test("a second row carrying a slug already in use is refused", async () => {
    const client = createClient({ url });
    try {
      await insertCompany(client, "ats-slug-company-b");
      await insertCompany(client, "ats-slug-company-c");
      await client.execute({
        sql: INSERT_SLUG,
        args: [
          "ats-slug-row-b",
          "shared-board",
          "ats-slug-company-b",
          "greenhouse",
          null,
          WRITTEN_AT,
          WRITTEN_AT,
        ],
      });
      await expect(
        client.execute({
          sql: INSERT_SLUG,
          args: [
            "ats-slug-row-c",
            "shared-board",
            "ats-slug-company-c",
            "lever",
            null,
            WRITTEN_AT,
            WRITTEN_AT,
          ],
        })
      ).rejects.toThrow();
    } finally {
      client.close();
    }
  });

  // Each ATS collector asks for the rows carrying its own name, so that lookup
  // reads an index rather than the whole table.
  test("an index covers collector", async () => {
    const covering = await indexesCovering(url, "AtsSlug", "collector");
    expect(covering.length, "no index covers collector alone").toBeGreaterThan(0);
  });
});

// Read straight off disk, the same way the Trace comment tests are.
describe("Job: the company_id comment says who decides a job's company", () => {
  test("association decides the company and save writes the column", () => {
    const schema = readFileSync(realSchemaPath, "utf-8");
    // The run of comment lines sitting directly above the field, whatever its
    // indentation inside the Job model.
    const match = schema.match(/((?:[ \t]*\/\/[^\n]*\n)+)[ \t]*company_id\b/);
    expect(match, "company_id field not found in schema.prisma").toBeTruthy();
    // Lowercased before matching, so a phrase that happens to open a
    // sentence is not missed on its capital letter alone.
    const comment = (match?.[1] ?? "").toLowerCase();
    expect(comment).toContain("company association");
    expect(comment).toContain("save writes the column");
  });
});

describe("Job and Setting: the columns save needs", () => {
  let dir: string;
  let jobColumns: ColumnInfo[];
  let settingColumns: ColumnInfo[];

  beforeAll(async () => {
    const temp = makeTempDb("pipeline-schema-save-columns-");
    dir = temp.dir;
    runDbCreate(temp.url);
    jobColumns = await tableColumns(temp.url, "Job");
    settingColumns = await tableColumns(temp.url, "Setting");
  }, CREATE_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function findColumn(columns: ColumnInfo[], name: string): ColumnInfo | undefined {
    const column = columns.find((candidate) => candidate.name === name);
    expect(column, `no column named ${name}`).toBeDefined();
    return column;
  }

  // A new column's declared type is compared against a column of the same
  // Prisma type already in the schema rather than against a literal, so the
  // assertion does not hardcode how Prisma spells a type in sqlite today.
  function typeOf(columns: ColumnInfo[], name: string): string {
    return String(findColumn(columns, name)?.type).toUpperCase();
  }

  test("collected_at is a date", () => {
    expect(typeOf(jobColumns, "collected_at")).toBe(typeOf(jobColumns, "posting_date"));
  });

  test("collected_at is required", () => {
    expect(findColumn(jobColumns, "collected_at")?.notnull).toBe(1);
  });

  test("collected_at carries no default", () => {
    expect(findColumn(jobColumns, "collected_at")?.dflt_value ?? null).toBeNull();
  });

  test("parser is a string", () => {
    expect(typeOf(jobColumns, "parser")).toBe(typeOf(jobColumns, "collector"));
  });

  test("parser is optional", () => {
    expect(findColumn(jobColumns, "parser")?.notnull).toBe(0);
  });

  test("source_priority_list is a Json column", () => {
    expect(typeOf(settingColumns, "source_priority_list")).toBe(
      typeOf(settingColumns, "search_terms")
    );
  });

  test("source_priority_list is nullable", () => {
    expect(findColumn(settingColumns, "source_priority_list")?.notnull).toBe(0);
  });
});

describe("Job: a row takes the id it was created with", () => {
  let dir: string;
  let url: string;

  const COLLECTED_AT = new Date("2026-01-01T00:00:00.000Z");

  beforeAll(() => {
    const temp = makeTempDb("pipeline-schema-explicit-id-");
    dir = temp.dir;
    url = temp.url;
    runDbCreate(url);
  }, CREATE_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // createPipelineDb reads the url at call time, so the environment only has
  // to hold the scratch value for the moment of construction, and whatever
  // was there before is put back.
  function clientFor(dbUrl: string): ReturnType<typeof createPipelineDb> {
    const previous = process.env["PIPELINE_DATABASE_URL"];
    process.env["PIPELINE_DATABASE_URL"] = dbUrl;
    const db = createPipelineDb();
    if (previous === undefined) delete process.env["PIPELINE_DATABASE_URL"];
    else process.env["PIPELINE_DATABASE_URL"] = previous;
    return db;
  }

  test("a create passing an id writes that id", async () => {
    const db = clientFor(url);
    await db.job.create({ data: { id: "known-id-123", collected_at: COLLECTED_AT } });
    const row = await db.job.findUnique({ where: { id: "known-id-123" } });
    expect(row?.id).toBe("known-id-123");
  });

  // Without this the test above would pass against a schema carrying no
  // default at all, which would break every create that does not supply one.
  test("a create omitting the id still gets one", async () => {
    const db = clientFor(url);
    const created = await db.job.create({ data: { collected_at: COLLECTED_AT } });
    expect(created.id).toHaveLength(25);
  });
});

// Dedupe's two link clauses match on these keys rather than on the raw links,
// so each needs an index to look a match up instead of reading every row.
// Neither may be unique: two rows for one posting hold the same key from the
// moment both are saved until the pass that collapses them, and a merge the
// active guardrail refuses leaves that pair standing for good.
describe("Job: the two link match-key columns and their indexes", () => {
  let dir: string;
  let url: string;

  const COLLECTED_AT = new Date("2026-01-01T00:00:00.000Z");
  const MATCH_KEY_COLUMNS = ["original_url_match_key", "resolved_url_match_key"];

  beforeAll(() => {
    const temp = makeTempDb("pipeline-schema-match-keys-");
    dir = temp.dir;
    url = temp.url;
    runDbCreate(url);
  }, CREATE_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test.each(MATCH_KEY_COLUMNS)("%s is an optional string", async (name) => {
    const column = (await tableColumns(url, "Job")).find((each) => each.name === name);
    expect(column, `${name} is not a Job column`).toBeTruthy();
    expect(column?.type).toBe("TEXT");
    expect(column?.notnull).toBe(0);
  });

  test.each(MATCH_KEY_COLUMNS)("an index covers %s", async (name) => {
    const covering = await indexesCovering(url, "Job", name);
    expect(covering.length, `no index covers ${name} alone`).toBeGreaterThan(0);
  });

  test.each(MATCH_KEY_COLUMNS)("no index on %s is unique", async (name) => {
    const covering = await indexesCovering(url, "Job", name);
    // Without this the assertion below would pass over an empty list, which
    // is a schema carrying no index at all rather than a non-unique one.
    expect(covering.length, `no index covers ${name} alone`).toBeGreaterThan(0);
    for (const index of covering) {
      expect(index.unique, `${index.name} is unique`).toBe(false);
    }
  });

  test("two rows carrying one original_url_match_key both save", async () => {
    // Written as raw SQL rather than through the generated client, because
    // what is under test is the database refusing nothing. id and modified_at
    // are supplied because Prisma fills both at write time rather than
    // through a SQL default.
    const key = "https://example.com/jobs/1";
    const client = createClient({ url });
    try {
      for (const id of ["match-key-row-a", "match-key-row-b"]) {
        await client.execute({
          sql: "INSERT INTO Job (id, collected_at, modified_at, original_url_match_key) VALUES (?, ?, ?, ?)",
          args: [id, COLLECTED_AT.getTime(), COLLECTED_AT.getTime(), key],
        });
      }
      const result = await client.execute({
        sql: "SELECT count(*) as count FROM Job WHERE original_url_match_key = ?",
        args: [key],
      });
      const record = result.rows[0] as unknown as Record<string, unknown>;
      expect(Number(record["count"])).toBe(2);
    } finally {
      client.close();
    }
  });
});

describe("Job: the company-and-title index dedupe looks a match up on", () => {
  let dir: string;
  let url: string;

  beforeAll(() => {
    const temp = makeTempDb("pipeline-schema-company-title-");
    dir = temp.dir;
    url = temp.url;
    runDbCreate(url);
  }, CREATE_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("one index covers company_id and title together, in that order", async () => {
    // Dedupe's third clause searches on both at once, so one combined index
    // serves it. Two separate indexes would leave the database picking one
    // and scanning for the other. company_id comes first because it narrows
    // hardest — a title is shared across employers.
    const indexes = await tableIndexes(url, "Job");
    const combined = indexes.filter(
      (index) => index.columns.length === 2 && index.columns[0] === "company_id"
    );
    expect(combined.length, "no index covers company_id and a second column").toBeGreaterThan(0);
    for (const index of combined) {
      expect(index.columns[1]).toBe("title");
    }
  });

  test("that index is not unique", async () => {
    // One employer legitimately holds several rows with one title until a
    // pass collapses them, and a refused merge leaves such a pair standing
    // for good.
    const indexes = await tableIndexes(url, "Job");
    const combined = indexes.filter(
      (index) => index.columns.length === 2 && index.columns[0] === "company_id"
    );
    expect(combined.length, "no index covers company_id and a second column").toBeGreaterThan(0);
    for (const index of combined) {
      expect(index.unique, `${index.name} is unique`).toBe(false);
    }
  });
});

// Read straight off disk, the same way the Trace comment tests are.
describe("Job: the status comment names every status a job can hold", () => {
  const ALL_STATUSES = [
    "backlog",
    "expired",
    "too far",
    "won't apply",
    "unresolvable",
    "unparseable",
    "rejected",
    "app. sent",
    "screening",
    "interview",
    "test",
    "offer",
  ];

  test("all twelve statuses are named", () => {
    const schema = readFileSync(realSchemaPath, "utf-8");
    // The run of comment lines sitting directly above the field, whatever its
    // indentation inside the Job model.
    const match = schema.match(/((?:[ \t]*\/\/[^\n]*\n)+)[ \t]*status\b/);
    expect(match, "status field not found in schema.prisma").toBeTruthy();
    // The comment is hard-wrapped across several "//" lines, so the markers go
    // and every run of whitespace collapses before the list is read. Splitting
    // on the separators between items is what makes a bare word like "test"
    // have to stand as its own item rather than being found inside another.
    const collapsed = (match?.[1] ?? "")
      .replace(/\/\//g, " ")
      .replace(/\s+/g, " ")
      .toLowerCase();
    const named = collapsed
      .split(/[,:]|\band\b/)
      .map((item) => item.trim().replace(/\.$/, ""));
    for (const status of ALL_STATUSES) {
      expect(named, `${status} is not named as its own item`).toContain(status);
    }
  });
});
