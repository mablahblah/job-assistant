import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createClient } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

// This file lives in prisma/, so the repo root is one level up.
const prismaDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(prismaDir, "..");
const realSchemaPath = resolve(prismaDir, "schema.prisma");
const packageJsonPath = resolve(repoRoot, "package.json");
const devDbPath = resolve(repoRoot, "dev.db");

// Creating a database runs the prisma CLI in a child process. A run measured
// at well under a second, so these are ceilings rather than budgets.
const CREATE_TIMEOUT_MS = 45_000;
const MULTI_CREATE_TIMEOUT_MS = 120_000;

const EXPECTED_JOB_COLUMNS = [
  "id",
  "company_id",
  "raw_company_name",
  "raw_company_slug",
  "raw_title",
  "original_url",
  "resolved_url",
  "posting_date",
  "posting_updated_date",
  "created_at",
  "modified_at",
  "is_resolved",
  "is_parsed",
  "is_classified",
  "status",
  "raw_location_list",
  "raw_mode_list",
  "collector",
  "raw_salary",
  "salary_low",
  "salary_high",
  "salary_period",
  "description",
];

const EXPECTED_COMPANY_COLUMNS = [
  "id",
  "name",
  "ats_platform",
  "ats_slug",
  "created_at",
  "modified_at",
];

// Setting is a single-row config table, not a key/value store. search_terms is
// the only Json column, because Json is reserved for fields holding a list.
const EXPECTED_SETTING_COLUMNS = [
  "id",
  "search_terms",
  "location",
  "radius",
  "expiry_threshold",
  "created_at",
  "modified_at",
];

// Columns the pipeline writes on its way to save. A collector fills only what
// its source supplied and a later phase fills the rest, so every one of these
// must be nullable or carry a default.
const COLLECTOR_WRITTEN_COLUMNS = [
  "raw_company_name",
  "raw_company_slug",
  "raw_title",
  "original_url",
  "resolved_url",
  "posting_date",
  "posting_updated_date",
  "raw_location_list",
  "raw_mode_list",
  "collector",
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

interface ColumnInfo {
  name: string;
  notnull: number;
  dflt_value: unknown;
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

  test("only the database-written columns are required without a default", async () => {
    const offenders = jobColumns.filter(
      (column) =>
        !DATABASE_WRITTEN_COLUMNS.includes(column.name) &&
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

  test("the schema declares no @map, so field names match column names", () => {
    expect(readFileSync(realSchemaPath, "utf-8")).not.toMatch(/@@?map\(/);
  });

  test("every column across the three tables is snake_case", async () => {
    const names = [
      ...(await columnNames(url, "Job")),
      ...(await columnNames(url, "Company")),
      ...(await columnNames(url, "Setting")),
    ];
    for (const name of names) {
      expect(name).toMatch(/^[a-z0-9_]+$/);
    }
  });
});
