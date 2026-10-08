// Flow test: Finding a job by its link.
//
// A database holding one employer's jobs: one whose saved links carry
// tracking bits, one whose two saved links clean to the same address, two
// saved under one link, one the user has applied to, and one no link reaches.
// The lookup command runs exactly as a skill runs it, once with a link to
// each, with lists of statuses, with an employer beside a link, and once as
// an employer search for comparison. Each answer is read as the data form
// both skills read.
//
// The pasted links carry tracking bits the saved links do not, the way an
// aiapply link did on 2026-10-01.
//
// Covers: A link finds its job, One job is returned once, Several link
// matches are listed, A matching link wins, A link that finds nothing is
// announced, Statuses narrow every search, Link results have the same fields,
// One answer form.
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

// Each test here spawns npx tsx, which costs a few seconds before the command
// itself starts. Vitest's own five-second default is below that floor.
const RUN_TIMEOUT_MS = 60_000;

// The identifying query values db-seed writes. Every saved key in this
// database is built with them, the way the job service builds a real one.
const IDENTIFYING_QUERY_VALUES = ["opportunityid"];

const COMPANY = { id: "co-acme", name: "Acme Design" };

// Saved links as they sit on each job, and the link the user pastes for it.
const JOBS = {
  tracked: {
    id: "job-tracked",
    status: "backlog",
    original_url: "https://www.adzuna.com/land/ad/5012345678?se=AbC123&utm_medium=api&v=1",
    resolved_url: "https://aiapply.co/jobs/acme-design/senior-product-designer?ref=feed&utm_source=x",
    pastedOriginal: "https://www.adzuna.com/land/ad/5012345678?se=ZzZ999&utm_medium=web",
    pastedResolved: "https://aiapply.co/jobs/acme-design/senior-product-designer?utm_campaign=share",
  },
  bothLinks: {
    id: "job-both-links",
    status: "backlog",
    original_url: "https://jobs.lever.co/acme/456?lever-source=adzuna",
    resolved_url: "https://jobs.lever.co/acme/456/",
    pasted: "https://jobs.lever.co/acme/456?lever-origin=applied",
  },
  sharedFirst: {
    id: "job-shared-first",
    status: "backlog",
    original_url: null,
    resolved_url: "https://acme.wd1.myworkdayjobs.com/careers/job/Remote/Designer_R789",
  },
  sharedSecond: {
    id: "job-shared-second",
    status: "backlog",
    original_url: "https://acme.wd1.myworkdayjobs.com/careers/job/Remote/Designer_R789?source=linkedin",
    resolved_url: null,
  },
  applied: {
    id: "job-applied",
    status: "app. sent",
    original_url: "https://jobs.ashbyhq.com/acme/321?utm_source=adzuna",
    resolved_url: null,
    pasted: "https://jobs.ashbyhq.com/acme/321",
  },
  unlinked: {
    id: "job-unlinked",
    status: "backlog",
    original_url: null,
    resolved_url: null,
  },
};

const SHARED_PASTED = "https://acme.wd1.myworkdayjobs.com/careers/job/Remote/Designer_R789?utm_source=indeed";

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

let dir: string;
let url: string;

beforeAll(async () => {
  const temp = makeTempDb("pipeline-find-jobs-by-link-");
  dir = temp.dir;
  url = temp.url;
  runScript("db-create.ts", url);
  runScript("db-seed.ts", url);

  const client = createClient({ url });
  try {
    await client.execute({
      sql: `INSERT INTO Company (id, name, match_key, created_at, modified_at)
            VALUES (?, ?, 'acme design', '2026-01-01', '2026-01-01')`,
      args: [COMPANY.id, COMPANY.name],
    });
    let day = 1;
    for (const job of Object.values(JOBS)) {
      await client.execute({
        sql: `INSERT INTO Job (id, company_id, title, status, posting_date, collected_at,
                               created_at, modified_at, is_resolved, is_parsed, is_classified,
                               original_url, original_url_match_key,
                               resolved_url, resolved_url_match_key, location_match_place)
              VALUES (?, ?, 'Senior Product Designer', ?, ?, '2026-01-01',
                      '2026-01-01', '2026-01-01', 1, 1, 1, ?, ?, ?, ?, 'Austin, TX')`,
        args: [
          job.id,
          COMPANY.id,
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
}, SETUP_TIMEOUT_MS);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("Finding a job by its link", () => {
  test(
    "a pasted link finds its job through either saved link, once, with the employer search's fields",
    () => {
      const employerAnswer = answerOf(runFind(url, ["--company", "acme"]));
      const employerJobs = new Map(employerAnswer.jobs.map((job) => [String(job["id"]), job]));

      const runs: Array<{ args: string[]; expected: string[] }> = [
        // A link finds its job: the job board's redirect link, saved first.
        { args: ["--url", JOBS.tracked.pastedOriginal], expected: [JOBS.tracked.id] },
        // A link finds its job: the source posting's link, saved second.
        { args: ["--url", JOBS.tracked.pastedResolved], expected: [JOBS.tracked.id] },
        // One job is returned once: both saved links clean to this address.
        { args: ["--url", JOBS.bothLinks.pasted], expected: [JOBS.bothLinks.id] },
        // Several link matches are listed: two jobs saved under one link.
        { args: ["--url", SHARED_PASTED], expected: [JOBS.sharedFirst.id, JOBS.sharedSecond.id] },
        // Statuses narrow every search: the applied job's own status is listed.
        {
          args: ["--url", JOBS.applied.pasted, "--statuses", "app. sent,screening"],
          expected: [JOBS.applied.id],
        },
        // A matching link wins: the employer's other jobs are left out.
        {
          args: ["--url", JOBS.tracked.pastedResolved, "--company", "acme"],
          expected: [JOBS.tracked.id],
        },
      ];

      for (const run of runs) {
        const answer = answerOf(runFind(url, run.args));

        expect(answer.found_by, run.args.join(" ")).toBe("link");
        expect(answer.link_problem, run.args.join(" ")).toBeNull();
        // Sorted ids compared whole, so a job listed twice fails here too.
        expect(idsOf(answer), run.args.join(" ")).toEqual([...run.expected].sort());
        // Link results have the same fields as a job found by employer.
        for (const job of answer.jobs) {
          expect(job, run.args.join(" ")).toEqual(employerJobs.get(String(job["id"])));
        }
      }
    },
    RUN_TIMEOUT_MS * 8
  );

  test(
    "a saved link left out by the status list answers with no job and says the link matched no job",
    () => {
      const answer = answerOf(
        runFind(url, ["--url", JOBS.applied.pasted, "--statuses", "backlog"])
      );

      expect(answer.found_by).toBe("link");
      expect(answer.link_problem).toBe("no_match");
      expect(answer.jobs).toEqual([]);
    },
    RUN_TIMEOUT_MS
  );
});
