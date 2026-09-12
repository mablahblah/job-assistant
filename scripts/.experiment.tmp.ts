// Throwaway: three ways of pacing adzuna resolutions, with a cooling-off gap
// between them so each starts from an unblocked state.
//
//   1. serial      — one at a time, each waiting for the last to finish
//   2. rolling 5s  — one started every 5 seconds, never waiting
//   3. rolling 7s  — the same, at 7 seconds
import { createPipelineDb } from "../lib/pipeline-db";
import { createResolutionBrowser } from "../lib/tools/resolution-browser";
import { resolveJobUrl } from "../lib/resolve-job-url";

const OPENING_WAIT_MIN = 7;
const BETWEEN_TESTS_MIN = 15;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clock(): string {
  return new Date().toTimeString().slice(0, 8);
}

async function pause(minutes: number, why: string): Promise<void> {
  console.log(`\n[${clock()}] waiting ${minutes} min — ${why}\n`);
  await wait(minutes * 60_000);
}

interface Result {
  label: string;
  tally: Map<string, number>;
  seconds: number;
  firstRefusalAt: number | null;
}

async function runTest(
  label: string,
  urls: string[],
  staggerMs: number | null
): Promise<Result> {
  console.log(`\n========== ${label} ==========`);
  console.log(`[${clock()}] ${urls.length} links\n`);

  const browser = await createResolutionBrowser();
  const startedAt = Date.now();
  const tally = new Map<string, number>();
  let firstRefusalAt: number | null = null;

  const runOne = async (index: number, url: string): Promise<void> => {
    const startOffset = Math.round((Date.now() - startedAt) / 1000);
    const opened = await browser.openPage();
    const t0 = Date.now();
    let key = "threw";
    let detail = "";
    try {
      const outcome = await resolveJobUrl(url, opened.page);
      if (outcome.outcome === "resolved") {
        key = "resolved";
        detail = new URL(outcome.resolvedUrl).host;
      } else if (outcome.outcome === "failed") {
        key = outcome.reason;
      } else {
        key = "blacklisted";
      }
    } catch (e) {
      detail = (e as Error).message.slice(0, 40);
    } finally {
      await opened.close();
    }
    if (key === "page_refused" && firstRefusalAt === null) firstRefusalAt = startOffset;
    tally.set(key, (tally.get(key) ?? 0) + 1);
    console.log(
      `${String(index + 1).padStart(2)}. t+${String(startOffset).padStart(3)}s ${key.padEnd(18)} ${String(Date.now() - t0).padStart(5)}ms  ${detail}`
    );
  };

  try {
    if (staggerMs === null) {
      for (let i = 0; i < urls.length; i++) await runOne(i, urls[i]!);
    } else {
      const started: Promise<void>[] = [];
      for (let i = 0; i < urls.length; i++) {
        started.push(runOne(i, urls[i]!));
        if (i < urls.length - 1) await wait(staggerMs);
      }
      await Promise.all(started);
    }
  } finally {
    await browser.close();
  }

  const seconds = Math.round((Date.now() - startedAt) / 1000);
  console.log(`\n[${clock()}] ${label} finished in ${seconds}s`);
  for (const [k, n] of [...tally.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`);
  return { label, tally, seconds, firstRefusalAt };
}

async function main(): Promise<void> {
  const db = createPipelineDb();
  const jobs = await db.job.findMany({
    where: { collector: "adzuna" },
    select: { original_url: true },
  });
  await db.$disconnect();
  const urls = jobs.map((j) => j.original_url!).filter(Boolean);

  console.log(`[${clock()}] three tests over ${urls.length} adzuna links`);
  await pause(OPENING_WAIT_MIN, "letting the last run's block clear");

  const results: Result[] = [];
  results.push(await runTest("TEST 1 — one at a time", urls, null));
  await pause(BETWEEN_TESTS_MIN, "cooling off before test 2");
  results.push(await runTest("TEST 2 — one started every 5s", urls, 5000));
  await pause(BETWEEN_TESTS_MIN, "cooling off before test 3");
  results.push(await runTest("TEST 3 — one started every 7s", urls, 7000));

  console.log("\n\n========== COMPARISON ==========");
  console.log("test                          resolved  refused  other  mins  first refusal");
  for (const r of results) {
    const resolved = r.tally.get("resolved") ?? 0;
    const refused = r.tally.get("page_refused") ?? 0;
    const other = [...r.tally.entries()]
      .filter(([k]) => k !== "resolved" && k !== "page_refused")
      .reduce((n, [, v]) => n + v, 0);
    const first = r.firstRefusalAt === null ? "none" : `t+${r.firstRefusalAt}s`;
    console.log(
      `${r.label.padEnd(30)}${String(resolved).padStart(5)}${String(refused).padStart(9)}${String(other).padStart(7)}${String(Math.round(r.seconds / 60)).padStart(6)}  ${first}`
    );
  }
}

main();
