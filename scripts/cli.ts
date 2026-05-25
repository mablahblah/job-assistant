// scripts/cli.ts
// Database operations for Claude Code commands.
// Usage: npx tsx scripts/cli.ts <subcommand> [args...]
// All output is JSON to stdout. Progress/errors to stderr.
import { prisma } from "@/lib/prisma";
import { enrichCompany } from "@/lib/company-enrichment";
import {
  readStdin,
  batchAlignment,
  batchFlagMismatch,
  batchStatus,
} from "@/lib/batch-update";
import { calculateScore } from "@/lib/scoring";
import type { Company, Job } from "@/lib/types";
import type { SaveableJob } from "@/lib/pipeline-save";

const [, , command, ...args] = process.argv;

// --- Helpers ---

// converts Prisma job+company rows into the shape calculateScore expects
function toScorable(
  job: { postedAt: Date; salaryRange: string; jobAlignment: number | null } & Record<string, unknown>,
  company: Record<string, unknown>,
): { job: Job; company: Company } {
  return {
    job: {
      ...job,
      postedAt: (job.postedAt as Date).toISOString(),
      modifiedAt: job.modifiedAt
        ? (job.modifiedAt as Date).toISOString()
        : null,
    } as unknown as Job,
    company: company as unknown as Company,
  };
}

function out(data: unknown) {
  console.log(JSON.stringify(data, null, 2));
}

function fail(msg: string): never {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

// --- Subcommands ---

async function expireJobs() {
  // marks backlog jobs older than 8 days as expired so they don't clutter the queue
  const cutoff = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  const result = await prisma.job.updateMany({
    where: { status: "backlog", postedAt: { lt: cutoff } },
    data: { status: "expired", modifiedAt: new Date() },
  });
  out({ expired: result.count });
}

async function queryBacklog() {
  // expire first, then return ranked backlog from last 7 days
  await expireJobs();

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const jobs = await prisma.job.findMany({
    where: { status: "backlog", postedAt: { gte: since } },
    include: { company: true },
  });

  // calculate composite score and sort descending so best matches come first
  const scored = jobs
    .map((j) => {
      const { job, company } = toScorable(j, j.company);
      return { ...j, score: calculateScore(job, company) };
    })
    .sort((a, b) => b.score - a.score);

  out(
    scored.map((j, i) => ({
      "#": i + 1,
      id: j.id,
      score: j.score,
      title: j.title,
      company: j.company.name,
      location: j.location,
      workMode: j.workMode,
      salary: j.salaryRange,
      url: j.url,
      ja: j.jobAlignment ?? "?",
      posted: j.postedAt.toISOString().slice(0, 10),
    })),
  );
}

async function queryActive() {
  // jobs beyond backlog status (in the application pipeline)
  const activeStatuses = [
    "app. sent",
    "screening",
    "interview",
    "test",
    "offer",
  ];
  const jobs = await prisma.job.findMany({
    where: { status: { in: activeStatuses } },
    include: { company: true },
    orderBy: { modifiedAt: "desc" },
  });

  out(
    jobs.map((j, i) => ({
      "#": i + 1,
      id: j.id,
      title: j.title,
      company: j.company.name,
      status: j.status,
      location: j.location,
      workMode: j.workMode,
      salary: j.salaryRange,
      url: j.url,
      modified: j.modifiedAt?.toISOString().slice(0, 10) ?? "—",
    })),
  );
}

async function queryLog() {
  // fetches the work search activity log with company contact info for TWC compliance
  const entries = await prisma.workSearchEntry.findMany({
    include: {
      job: { include: { company: true } },
    },
    orderBy: { date: "desc" },
  });

  out(
    entries.map((e) => ({
      id: e.id,
      date: e.date.toISOString().slice(0, 10),
      activity: e.activityType,
      result: e.result,
      jobTitle: e.job.title,
      company: e.job.company.name,
      address: e.job.company.address ?? "—",
      phone: e.job.company.phone ?? "—",
      website: e.job.company.website ?? "—",
      enrichmentStatus: e.job.company.enrichmentStatus ?? "none",
      enrichmentUncertain: e.job.company.enrichmentUncertain,
    })),
  );
}

async function runBatchStatus() {
  // reads status changes from stdin JSON, applies them and auto-logs qualifying changes
  const raw = await readStdin();
  let items;
  try { items = JSON.parse(raw); } catch { fail("Invalid JSON on stdin"); }
  const result = await batchStatus(items);
  out(result);
}

async function saveCompanyScore() {
  // args: "Company Name" <es> <cs> <wl> <pa> "note text"
  if (args.length < 6) {
    fail(
      'Usage: score "Company Name" <es> <cs> <wl> <pa> "note"',
    );
  }
  const [name, es, cs, wl, pa, ...noteParts] = args;
  const note = noteParts.join(" ");

  const company = await prisma.company.findUnique({ where: { name } });
  if (!company) fail(`Company not found: "${name}"`);

  await prisma.company.update({
    where: { id: company!.id },
    data: {
      employeeSatisfaction: parseInt(es) || null,
      customerSatisfaction: parseInt(cs) || null,
      workLifeBalance: parseInt(wl) || null,
      politicalAlignment: parseInt(pa) || null,
      note: note || null,
    },
  });

  out({ updated: true, company: name, es, cs, wl, pa, note });
}

async function runBatchAlignment() {
  // reads alignment scores from stdin JSON, saves them all at once
  const raw = await readStdin();
  let items;
  try { items = JSON.parse(raw); } catch { fail("Invalid JSON on stdin"); }
  const result = await batchAlignment(items);
  out(result);
}

async function runBatchFlagMismatch() {
  // reads title mismatch flags from stdin JSON, saves them all at once
  const raw = await readStdin();
  let items;
  try { items = JSON.parse(raw); } catch { fail("Invalid JSON on stdin"); }
  const result = await batchFlagMismatch(items);
  out(result);
}


async function queryUnscored() {
  // returns companies that are missing at least one score dimension
  const companies = await prisma.company.findMany({
    where: {
      OR: [
        { employeeSatisfaction: null },
        { customerSatisfaction: null },
        { workLifeBalance: null },
        { politicalAlignment: null },
      ],
    },
    orderBy: { name: "asc" },
  });

  out(
    companies.map((c) => ({
      id: c.id,
      name: c.name,
      es: c.employeeSatisfaction ?? "?",
      cs: c.customerSatisfaction ?? "?",
      wl: c.workLifeBalance ?? "?",
      pa: c.politicalAlignment ?? "?",
    })),
  );
}

async function queryNewJobs() {
  // jobs added in the last scrape run (default: last 10 minutes)
  const minutesAgo = parseInt(args[0] ?? "10");
  const since = new Date(Date.now() - minutesAgo * 60 * 1000);

  const jobs = await prisma.job.findMany({
    where: { createdAt: { gte: since } },
    include: { company: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  out(
    jobs.map((j) => ({
      id: j.id,
      title: j.title,
      company: j.company.name,
      url: j.url,
      location: j.location,
      workMode: j.workMode,
      salary: j.salaryRange,
      status: j.status,
      posted: j.postedAt.toISOString().slice(0, 10),
    })),
  );
}

async function enrichLogCompanies() {
  // finds companies in the work search log that haven't been enriched yet and triggers enrichment
  const entries = await prisma.workSearchEntry.findMany({
    include: { job: { include: { company: true } } },
  });

  // dedupe by company id, only pick companies not yet enriched
  const seen = new Set<string>();
  const toEnrich: { companyId: string; location: string }[] = [];
  for (const e of entries) {
    const c = e.job.company;
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    if (!c.enrichedAt) {
      toEnrich.push({ companyId: c.id, location: e.job.location });
    }
  }

  if (toEnrich.length === 0) {
    out({ enriched: 0 });
    return;
  }

  // set pending synchronously, then fire-and-forget enrichment
  for (const { companyId } of toEnrich) {
    await prisma.company.update({
      where: { id: companyId },
      data: { enrichmentStatus: "pending" },
    });
  }

  // fire all enrichments in parallel, don't wait for them
  for (const { companyId, location } of toEnrich) {
    enrichCompany(companyId, location).catch(console.error);
  }

  out({ enriched: toEnrich.length });
}

async function classifyHeldBack() {
  const filePath = args[0];
  if (!filePath) {
    fail("Usage: classify-held-back <path-to-held-back-file>");
  }

  const { readFileSync } = await import("fs");
  const { classifyJobLocations } = await import("@/lib/geocoding");
  const { saveParsedJobs } = await import("@/lib/pipeline-save");

  // Parse and validate the held-back file
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    fail(`Could not read held-back file: ${filePath}`);
  }

  const parsed = raw as { mode?: string; jobs?: unknown[] };
  if (parsed.mode !== "search" && parsed.mode !== "external") {
    fail(`Invalid mode in held-back file: ${parsed.mode}`);
  }
  if (!Array.isArray(parsed.jobs) || parsed.jobs.length === 0) {
    fail("Held-back file contains no jobs");
  }
  const mode = parsed.mode as "search" | "external";
  const jobs = parsed.jobs as SaveableJob[];

  // Validate required fields on each job (file is pipeline-written but path is user-provided)
  for (const job of jobs) {
    if (!job.url || !job.title || !job.companyName || !job.postedAt || !job.source) {
      fail(`Job missing required fields: ${JSON.stringify(job).slice(0, 100)}`);
    }
  }

  // Skip jobs that were already saved by a subsequent pipeline run
  const existingUrls = new Set(
    (await prisma.job.findMany({ where: { url: { in: jobs.map((j) => j.url) } }, select: { url: true } }))
      .map((j) => j.url),
  );
  const newJobs = jobs.filter((j) => !existingUrls.has(j.url));
  if (existingUrls.size > 0) {
    console.error(`[classify-held-back] Skipping ${existingUrls.size} job(s) already in DB (collected in a later run)`);
  }
  if (newJobs.length === 0) {
    out({ saved: 0, skipped: existingUrls.size, savedJobIds: [] });
    return;
  }

  const geoInput = newJobs.map((j) => ({
    location: j.location ?? "",
    workMode: j.workMode ?? "",
  }));

  const { results: geoResults, allUnknownClasses } = await classifyJobLocations(geoInput);

  // Check if any classes are STILL unknown after user classification
  if (allUnknownClasses.length > 0) {
    console.error(`[classify-held-back] Still ${allUnknownClasses.length} unknown class(es):`);
    for (const uc of allUnknownClasses) {
      console.error(`  - class="${uc.className}" from "${uc.locationString}"`);
    }
    fail("Resolve all unknown classes before running classify-held-back");
  }

  // Annotate jobs with geo classification and save
  const annotatedJobs: SaveableJob[] = newJobs.map((job, i) => ({
    ...job,
    geoStatus: geoResults[i].status,
  }));

  const save = await saveParsedJobs(annotatedJobs, mode);
  out(save);
}

async function manageGeoClass() {
  // Usage: geocode-class allow <className> OR geocode-class block <className>
  if (args.length < 2) {
    fail('Usage: geocode-class allow|block <className>');
  }

  const [action, className] = args;
  if (action !== "allow" && action !== "block") {
    fail('Action must be "allow" or "block"');
  }

  // Upsert so re-classifying an existing rule works
  await prisma.geocodingClassRule.upsert({
    where: { className },
    create: { className, action },
    update: { action },
  });

  out({ updated: true, className, action });
}

// --- Dispatch ---

const commands: Record<string, () => Promise<void>> = {
  expire: expireJobs,
  backlog: queryBacklog,
  active: queryActive,
  log: queryLog,
  status: runBatchStatus,
  score: saveCompanyScore,
  alignment: runBatchAlignment,
  "flag-mismatch": runBatchFlagMismatch,
  unscored: queryUnscored,
  "new-jobs": queryNewJobs,
  "enrich-log": enrichLogCompanies,
  "geocode-class": manageGeoClass,
  "classify-held-back": classifyHeldBack,
};

if (!command || !commands[command]) {
  console.error(`Usage: npx tsx scripts/cli.ts <command> [args...]`);
  console.error(`Commands: ${Object.keys(commands).join(", ")}`);
  process.exit(1);
}

commands[command]()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
