// scripts/cli.ts
// Database operations for Claude Code commands.
// Usage: npx tsx scripts/cli.ts <subcommand> [args...]
// All output is JSON to stdout. Progress/errors to stderr.
import { prisma } from "@/lib/prisma";
import { logWorkSearchActivity } from "@/lib/work-search-log";
import { enrichCompany } from "@/lib/company-enrichment";
import { calculateScore } from "@/lib/scoring";
import type { Company, Job } from "@/lib/types";

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

async function changeStatus() {
  const [jobId, newStatus] = args;
  if (!jobId || !newStatus) fail("Usage: status <jobId> <newStatus>");

  await prisma.job.update({
    where: { id: jobId },
    data: { status: newStatus, modifiedAt: new Date(), locationFlagged: false },
  });

  // auto-log qualifying status changes for TWC work search compliance
  await logWorkSearchActivity(jobId, newStatus);

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: { company: { select: { name: true } } },
  });
  out({
    updated: true,
    id: jobId,
    status: newStatus,
    company: job?.company.name,
    title: job?.title,
  });
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

async function saveJobAlignment() {
  // saves a 1-5 job alignment score for how well a posting matches Matthew's profile
  const [jobId, scoreStr] = args;
  if (!jobId || !scoreStr) fail("Usage: alignment <jobId> <score>");

  const score = parseInt(scoreStr);
  if (score < 1 || score > 5) fail("Score must be 1-5");

  await prisma.job.update({
    where: { id: jobId },
    data: { jobAlignment: score },
  });

  out({ updated: true, jobId, jobAlignment: score });
}

async function flagTitleMismatch() {
  // marks a job where the actual role doesn't match what the title implies
  const [jobId, ...reasonParts] = args;
  if (!jobId || reasonParts.length === 0)
    fail('Usage: flag-mismatch <jobId> "reason"');

  await prisma.job.update({
    where: { id: jobId },
    data: {
      titleMismatch: true,
      titleMismatchReason: reasonParts.join(" "),
    },
  });

  out({ flagged: true, jobId, reason: reasonParts.join(" ") });
}

async function flagAggregator() {
  // marks a job as posted by an aggregator (staffing/recruiting firm) rather than the real employer
  const [jobId] = args;
  if (!jobId) fail("Usage: flag-aggregator <jobId>");

  await prisma.job.update({
    where: { id: jobId },
    data: { isUnresolvedAggregator: true },
  });

  out({ flagged: true, jobId });
}

async function unflagAggregator() {
  // clears the aggregator flag once the real employer has been identified
  const [jobId] = args;
  if (!jobId) fail("Usage: unflag-aggregator <jobId>");

  await prisma.job.update({
    where: { id: jobId },
    data: { isUnresolvedAggregator: false },
  });

  out({ unflagged: true, jobId });
}

async function listAggregators() {
  // returns all known recruiting/staffing aggregator names stored in the DB
  const aggregators = await prisma.aggregator.findMany({
    orderBy: { name: "asc" },
  });
  out(aggregators.map((a) => a.name));
}

async function addAggregator() {
  // adds a new aggregator name to the known list (upsert — safe to run twice)
  const [name] = args;
  if (!name) fail("Usage: add-aggregator <name>");

  await prisma.aggregator.upsert({
    where: { name },
    create: { name },
    update: {},
  });

  out({ added: true, name });
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

// --- Dispatch ---

const commands: Record<string, () => Promise<void>> = {
  expire: expireJobs,
  backlog: queryBacklog,
  active: queryActive,
  log: queryLog,
  status: changeStatus,
  score: saveCompanyScore,
  alignment: saveJobAlignment,
  "flag-mismatch": flagTitleMismatch,
  "flag-aggregator": flagAggregator,
  "unflag-aggregator": unflagAggregator,
  aggregators: listAggregators,
  "add-aggregator": addAggregator,
  unscored: queryUnscored,
  "new-jobs": queryNewJobs,
  "enrich-log": enrichLogCompanies,
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
