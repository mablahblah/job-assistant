// Starts a job search: runs collection and reports what it found. Later
// phases of the pipeline add their own step here, after this one.
import { createPipelineDb } from "../lib/pipeline-db";
import { createSettingsService } from "../lib/settings-service";
import { runCollection, type CollectionIssue } from "../lib/search-orchestrator";
import { COLLECTORS } from "../lib/collectors/registry";

// One line per issue, naming both the collector and its own message, since
// that message is what names the board or search behind it.
function printIssues(label: string, issues: CollectionIssue[]): void {
  if (issues.length === 0) {
    console.log(`${label}: none`);
    return;
  }
  console.log(`${label}:`);
  for (const issue of issues) {
    console.log(`  ${issue.collector}: ${issue.message}`);
  }
}

// Reads `--limit N` off the command line. Omitted means collect everything.
// A limit of 0 reaches no source at all, which is how the test suite runs this
// command without touching a job site.
function limitFromArgs(argv: string[]): number | undefined {
  const flag = argv.indexOf("--limit");
  if (flag === -1) return undefined;
  const value = Number(argv[flag + 1]);
  if (!Number.isFinite(value)) {
    throw new Error("--limit needs a number, for example --limit 1");
  }
  return value;
}

async function main(): Promise<void> {
  const limit = limitFromArgs(process.argv.slice(2));
  const prisma = createPipelineDb();
  try {
    const settings = createSettingsService(prisma);
    const report = await runCollection({ settings, collectors: COLLECTORS, limit });

    // Errors and warnings first, so a source that dropped out is the first
    // thing read rather than something noticed weeks later.
    printIssues("Errors", report.errors);
    printIssues("Warnings", report.warnings);

    // The job list itself, as JSON on stdout, so an agent reading the command
    // can consume it. Collection stops at a list in memory; saving it belongs
    // to a later phase.
    console.log(JSON.stringify(report.jobs));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
