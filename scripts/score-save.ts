// Scoring cannot run inside the pipeline: deciding whether a job or company
// is worth pursuing takes an agent's judgment, not a deterministic step. This
// command is the second half — the answers an agent worked out have to reach
// the database, and this is what writes them down. It runs once per batch, so
// a run that stops halfway still keeps the research it already paid for.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPipelineDb } from "../lib/db/pipeline-db";
import { createAtsSlugService } from "../lib/services/ats-slug-service";
import { createCompanyService } from "../lib/services/company-service";
import { createJobService } from "../lib/services/job-service";
import { createSettingsService } from "../lib/services/settings-service";
import { createTraceService } from "../lib/services/trace-service";
import type { CollectionIssue } from "../lib/types/collection-issue";
import type { CompanyScore, JobScore } from "../lib/orchestrators/scoring";
import { runScoringSave } from "../lib/orchestrators/scoring";
import { schemaProbesFor } from "../lib/db/schema-check";
import { schemaHasDrifted } from "../lib/db/schema-drift";
import { summaryFromTraceCounts } from "../lib/utils/run-summary";
import { COLLECTORS } from "../lib/collectors/registry";
import { flagValue } from "../lib/utils/cli-args";
import { issueLines } from "../lib/utils/print-issues";

// The shape an agent's answer file is expected to hold. It comes from disk,
// not from code, so it is untrusted until this one cast brings it into the
// type system — everything after that point can trust JobScore/CompanyScore.
interface ScoreSaveFile {
  runId: string;
  jobs?: JobScore[];
  companies?: CompanyScore[];
}

// Prints what the shared builder laid out, so the wording of a reported
// problem lives in one place and only the printing is local.
function printIssues(label: string, issues: CollectionIssue[]): void {
  for (const line of issueLines(label, issues)) console.log(line);
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const inPath = flagValue(argv, "in");
  // This command runs once per batch, so reprinting a growing summary after
  // each one is noise. The caller asks for it on the last batch instead.
  const showSummary = hasFlag(argv, "summary");

  // Nothing here is worth doing if there is nothing to read, and failing
  // before the database is even opened keeps this check free of side
  // effects to reason about.
  if (!inPath) {
    console.error("Missing required flag: --in <path>");
    process.exitCode = 1;
    return;
  }

  const source = resolve(inPath);
  const raw = readFileSync(source, "utf-8");
  // Single documented cast: the file on disk is untrusted JSON, so this is
  // the one place that shape is asserted rather than sprinkled everywhere.
  const parsed = JSON.parse(raw) as ScoreSaveFile;
  const jobScores = parsed.jobs ?? [];
  const companyScores = parsed.companies ?? [];

  const prisma = createPipelineDb();
  try {
    // Same reasoning as job-search.ts: a database that cannot be read should
    // stop the run here, loudly, rather than fail silently partway through.
    if (await schemaHasDrifted(schemaProbesFor(prisma))) {
      process.exitCode = 1;
      return;
    }

    const settings = createSettingsService(prisma);
    const trace = createTraceService(prisma);
    const companies = createCompanyService(prisma);
    const jobService = createJobService(prisma);
    // The one way anything reaches the ATS slug table, which is where a
    // promoted company's board gains the collector that polls it.
    const atsSlugs = createAtsSlugService(prisma);

    // Minted once so every company this call scores is written with the
    // same date, rather than drifting as the save takes time.
    const scoredAt = new Date();

    const result = await runScoringSave({
      jobScores,
      companyScores,
      settings,
      companies,
      jobService,
      atsSlugs,
      trace,
      runId: parsed.runId,
      scoredAt,
    });

    console.log(
      `Saved ${jobScores.length} job score(s) and ${companyScores.length} compan${
        companyScores.length === 1 ? "y" : "ies"
      } score(s).`
    );

    printIssues("Warnings", result.warnings);

    if (result.failure) {
      console.log(`Run stopped at ${result.failure.at}: ${result.failure.reason}`);
    }

    if (result.traceFailures > 0) {
      console.log(`Trace failures: ${result.traceFailures}`);
    }

    // Read back from the run's own rows rather than from what the save
    // returned, the way the pipeline command does it: the per-reason numbers
    // exist only in those rows, and nothing else prints a summary once
    // scoring has run.
    if (showSummary) {
      const counts = await trace.countsForRun(parsed.runId);
      const collectorNames = COLLECTORS.map((collector) => collector.name);
      const stoppedAt = result.failure?.at ?? null;
      for (const line of summaryFromTraceCounts(counts, collectorNames, stoppedAt)) {
        console.log(line);
      }
    }

    // Set rather than exited on, so the disconnect below still runs and
    // anything already written to stdout is flushed before the process ends.
    if (result.failure) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
