// Flow test: Falling back to the employer.
//
// A database holding two employers' jobs, and a copy of every table's rows
// taken before any lookup runs. The lookup command runs exactly as a skill
// runs it: with an employer beside a link no job holds, beside text that is
// not a web address, with each of those links alone, with an employer part in
// odd letter case, with a list of statuses, with an employer no job holds, and
// with nothing at all. Each answer is read as the data form both skills read,
// then every table is compared with the copy.
//
// Covers: A link that matches nothing falls back, A link that finds nothing is
// announced, Text that is not a link is named, Text that is not a link falls
// back, An empty search is an empty list, Nothing to search by is refused,
// Employer search is left as it was, Statuses narrow every search, One answer
// form, The lookup changes nothing.
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { createClient } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { urlMatchKey } from "../lib/utils/url-match-key";

// This file lives in scripts/, so the repo root is one level up.
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");

// Creating, seeding and several inserts each spawn or open something in turn.
// A ceiling rather than a budget.
const SETUP_TIMEOUT_MS = 120_000;

// Each run here spawns npx tsx, which costs a few seconds before the command
// itself starts. Vitest's own five-second default is below that floor.
const RUN_TIMEOUT_MS = 60_000;

// The identifying query values db-seed writes. Every saved key in this
// database is built with them, the way the job service builds a real one.
const IDENTIFYING_QUERY_VALUES = ["opportunityid"];

const COMPANIES = [
  { id: "co-acme", name: "Acme Design", match_key: "acme design" },
  { id: "co-canva", name: "Canva", match_key: "canva" },
];

const JOBS = [
  {
    id: "job-tracked",
    company_id: "co-acme",
    status: "backlog",
    original_url: "https://www.adzuna.com/land/ad/5012345678?se=AbC123&utm_medium=api",
    resolved_url: "https://aiapply.co/jobs/acme-design/senior-product-designer?ref=feed",
  },
  {
    id: "job-applied",
    company_id: "co-acme",
    status: "app. sent",
    original_url: "https://jobs.ashbyhq.com/acme/321?utm_source=adzuna",
    resolved_url: null,
  },
  {
    id: "job-unlinked",
    company_id: "co-acme",
    status: "backlog",
    original_url: null,
    resolved_url: null,
  },
  {
    id: "job-canva",
    company_id: "co-canva",
    status: "backlog",
    original_url: "https://jobs.lever.co/canva/999",
    resolved_url: null,
  },
];

const ACME_JOB_IDS = ["job-applied", "job-tracked", "job-unlinked"];

// A real web address that neither saved link of any job points to.
const UNSAVED_LINK = "https://jobs.lever.co/acme/never-saved?utm_source=linkedin";

// Text a user might paste that the built-in address reader rejects.
const NOT_A_LINK = "acme senior product designer";

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface Answer {
  found_by: string;
  link_problem: string | null;
  jobs: Array<Record<string, unknown>>;
}

// An absolute url, because a relative Prisma url resolves from the directory
// holding prisma.config.ts rather than from the working directory.
function makeTempDb(prefix: string): { dir: string; url: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, url: `file:${join(dir, "pipeline.db")}` };
}

function runScript(script: string, url: string): void {
  // db-create takes its target as an argument and refuses to run without
  // one; every other script still reads the url from the environment.
  const args = script === "db-create.ts" ? [url] : [];
  execFileSync("npx", ["tsx", `scripts/${script}`, ...args], {
    cwd: repoRoot,
    env: { ...process.env, PIPELINE_DATABASE_URL: url },
    stdio: "pipe",
  });
}

function runFind(url: string, args: string[]): RunResult {
  const result = spawnSync("npx", ["tsx", "scripts/find-jobs.ts", ...args], {
    cwd: repoRoot,
    env: { ...process.env, PIPELINE_DATABASE_URL: url },
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// Every run a skill reads must succeed and print the data form and nothing
// else, so a run that fails or prints sentences fails here, by name.
function answerOf(result: RunResult): Answer {
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as Answer;
}

function idsOf(answer: Answer): string[] {
  return answer.jobs.map((job) => String(job["id"])).sort();
}

// A row written straight into the database gets no key from anything else,
// so each saved link carries the key the job service would have written.
function keyOf(link: string | null): string | null {
  return link === null ? null : urlMatchKey(link, IDENTIFYING_QUERY_VALUES);
}

// Every row of every table, keyed by table name. Read before and after the
// lookups, so a write to any table, including one this feature never names,
// shows up as a difference.
async function everyTablesRows(url: string): Promise<Record<string, unknown[]>> {
  const client = createClient({ url });
  try {
    const tables = await client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    );
    const copy: Record<string, unknown[]> = {};
    for (const row of tables.rows) {
      const name = String(row["name"]);
      const rows = await client.execute(`SELECT * FROM "${name}" ORDER BY rowid`);
      copy[name] = rows.rows.map((r) => ({ ...r }));
    }
    return copy;
  } finally {
    client.close();
  }
}

let dir: string;
let url: string;
let rowsBefore: Record<string, unknown[]>;

beforeAll(async () => {
  const temp = makeTempDb("pipeline-find-jobs-fallback-");
  dir = temp.dir;
  url = temp.url;
  runScript("db-create.ts", url);
  runScript("db-seed.ts", url);

  const client = createClient({ url });
  try {
    for (const company of COMPANIES) {
      await client.execute({
        sql: `INSERT INTO Company (id, name, match_key, created_at, modified_at)
              VALUES (?, ?, ?, '2026-01-01', '2026-01-01')`,
        args: [company.id, company.name, company.match_key],
      });
    }
    let day = 1;
    for (const job of JOBS) {
      await client.execute({
        sql: `INSERT INTO Job (id, company_id, title, status, posting_date, collected_at,
                               created_at, modified_at, is_resolved, is_parsed, is_classified,
                               original_url, original_url_match_key,
                               resolved_url, resolved_url_match_key, location_match_place)
              VALUES (?, ?, 'Senior Product Designer', ?, ?, '2026-01-01',
                      '2026-01-01', '2026-01-01', 1, 1, 1, ?, ?, ?, ?, 'Austin, TX')`,
        args: [
          job.id,
          job.company_id,
          job.status,
          `2026-09-${String(day).padStart(2, "0")}`,
          job.original_url,
          keyOf(job.original_url),
          job.resolved_url,
          keyOf(job.resolved_url),
        ],
      });
      day += 1;
    }
  } finally {
    client.close();
  }

  rowsBefore = await everyTablesRows(url);
}, SETUP_TIMEOUT_MS);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("Falling back to the employer", () => {
  test(
    "each lookup answers with the jobs, the search that found them and the link's problem, and nothing is written",
    async () => {
      const runs: Array<{
        args: string[];
        found_by: string;
        link_problem: string | null;
        expected: string[];
      }> = [
        // A link that matches nothing falls back, and says the link matched no job.
        {
          args: ["--url", UNSAVED_LINK, "--company", "acme"],
          found_by: "employer",
          link_problem: "no_match",
          expected: ACME_JOB_IDS,
        },
        // Text that is not a link is named, and falls back.
        {
          args: ["--url", NOT_A_LINK, "--company", "acme"],
          found_by: "employer",
          link_problem: "not_a_link",
          expected: ACME_JOB_IDS,
        },
        // A link that finds nothing is announced, with nothing to fall back to.
        {
          args: ["--url", UNSAVED_LINK],
          found_by: "link",
          link_problem: "no_match",
          expected: [],
        },
        // Text that is not a link is named, with nothing to fall back to.
        {
          args: ["--url", NOT_A_LINK],
          found_by: "link",
          link_problem: "not_a_link",
          expected: [],
        },
        // Employer search is left as it was: a run of letters in the middle of
        // the stored name, in a different letter case.
        {
          args: ["--company", "mE dEs"],
          found_by: "employer",
          link_problem: null,
          expected: ACME_JOB_IDS,
        },
        // Statuses narrow every search.
        {
          args: ["--company", "acme", "--statuses", "app. sent"],
          found_by: "employer",
          link_problem: null,
          expected: ["job-applied"],
        },
        // An empty search is an empty list.
        {
          args: ["--company", "nobody-by-that-name"],
          found_by: "employer",
          link_problem: null,
          expected: [],
        },
      ];

      for (const run of runs) {
        const answer = answerOf(runFind(url, run.args));
        const label = run.args.join(" ");

        expect(answer.found_by, label).toBe(run.found_by);
        expect(answer.link_problem, label).toBe(run.link_problem);
        expect(idsOf(answer), label).toEqual([...run.expected].sort());
      }

      // Nothing to search by is refused, with a message asking for one.
      const refused = runFind(url, []);
      expect(refused.status).not.toBe(0);
      expect(refused.stderr).toContain("--url");
      expect(refused.stderr).toContain("--company");

      // The lookup changes nothing.
      expect(await everyTablesRows(url)).toEqual(rowsBefore);
    },
    RUN_TIMEOUT_MS * 9
  );
});
