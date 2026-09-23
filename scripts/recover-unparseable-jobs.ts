// Returns jobs that were set aside before any parser could read them.
//
// A job whose link sits on a website no parser owns is set aside at status
// "unparseable", and the step that feeds parsing reads only jobs at status
// "backlog" — so nothing looks at that status again on its own. When a new
// parser is shipped, some of those jobs become readable after all. They are
// simply sitting at the wrong status to be tried.
//
// Measured 2026-09-21: 145 jobs sat at "unparseable", 42 on Workday or
// UltiPro and 103 on websites no parser owns; without this command, shipping
// a parser would deliver none of those 42.
//
// This is a command of its own, run once, by hand. A job search never runs
// it: it is not a handler, it is not named by the orchestrator, and nothing
// here is reachable from npm run job-search.
//
// It takes no flags, because the recovery has nothing to choose.
import { createPipelineDb } from "../lib/db/pipeline-db";
import { schemaProbesFor } from "../lib/db/schema-check";
import { schemaHasDrifted } from "../lib/db/schema-drift";
import { createSettingsService } from "../lib/services/settings-service";
import { createJobService } from "../lib/services/job-service";
import { createCompanyService } from "../lib/services/company-service";
import { createWorkLogService } from "../lib/services/work-log-service";
import { createCompanySearch } from "../lib/tools/company-search";
import { runStatusChange } from "../lib/orchestrators/status-change";
import { statusChangeReport } from "../lib/utils/status-change-report";
import { parserForUrl } from "../lib/parsers/registry";
import type { StatusChange } from "../lib/handlers/status-change";

async function main(): Promise<void> {
  const prisma = createPipelineDb();
  try {
    // The same check every other command runs, before anything is written. It
    // reads each table whole and reports only the table's name, which is why
    // the message names tables rather than columns.
    if (await schemaHasDrifted(schemaProbesFor(prisma))) {
      process.exitCode = 1;
      return;
    }

    const settings = createSettingsService(prisma);
    const jobs = createJobService(prisma);
    const companies = createCompanyService(prisma);
    const workLog = createWorkLogService(prisma);
    const search = createCompanySearch();
    const priorityList = await settings.getSourcePriorityList();

    const unparseable = await jobs.findByStatuses(["unparseable"]);

    // The registry is asked, and nothing else is. Knowledge of which parser
    // reads which link belongs to the registry and the parsers, so this
    // command holds none of it. A job with no link at all cannot be claimed
    // by anything.
    //
    // The id is checked too. Every field on a job's in-memory shape is
    // optional, because a collector fills only what its source supplied, so a
    // row read back from the database still types its id as possibly absent.
    const changes: StatusChange[] = [];
    for (const row of unparseable) {
      const { id, resolved_url: link } = row.job;
      if (id === undefined || !link) {
        continue;
      }
      if (parserForUrl(link) === null) {
        continue;
      }
      changes.push({ job_id: id, status: "backlog" });
    }

    // Handed to the same code a status change typed by hand runs through,
    // because that is the one implementation of a status change and a second
    // one would be a defect. A move to "backlog" writes no work log entry,
    // and the employer search only runs for a job whose entry was written, so
    // this recovery pays for no searches.
    const result = await runStatusChange(changes, {
      jobs,
      companies,
      workLog,
      search,
      priorityList,
      now: new Date(),
    });

    // The three counts account for every job read: one moved, or one left.
    // An empty list is an ordinary answer, so a second run prints its zeros
    // rather than failing.
    console.log(`Read ${unparseable.length} job(s) at status "unparseable".`);
    console.log(`Moved ${changes.length} a parser now claims to "backlog".`);
    console.log(`Left ${unparseable.length - changes.length} alone.`);

    for (const line of statusChangeReport({
      changes: result.changes,
      companies: result.companies,
    })) {
      console.log(line);
    }

    if (result.warnings.length === 0) {
      console.log("Warnings: none");
    } else {
      console.log("Warnings:");
      for (const warning of result.warnings) {
        console.log(`  ${warning}`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
