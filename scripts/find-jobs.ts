// Finds the job the user means. Every other job command needs an id, and the
// user has none: a job is named the way a person names it, by who is hiring
// and roughly what the role is. Until the web view exists nothing else in
// this app turns those words into an id, so this command is that step.
//
// It only reads. Nothing here writes, which is why a run that matches nothing
// is an ordinary answer rather than a failure.
import { createPipelineDb } from "../lib/db/pipeline-db";
import { schemaProbesFor } from "../lib/db/schema-check";
import { schemaHasDrifted } from "../lib/db/schema-drift";
import { createJobService, type JobSearchMatch } from "../lib/services/job-service";
import { flagValue } from "../lib/utils/cli-args";

// A comma-separated flag arrives as one string carrying whatever spacing and
// stray commas were typed. A trailing comma must not become a phantom status
// nothing can ever hold, and a flag with nothing usable in it means the same
// as leaving the flag off.
function parseStatuses(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const statuses = raw
    .split(",")
    .map((status) => status.trim())
    .filter((status) => status.length > 0);
  return statuses.length > 0 ? statuses : undefined;
}

// Shared by the heading and the nothing-matched line, so the two never
// describe the same search differently.
function describeSearch(
  companyNamePart: string,
  titlePart: string | undefined,
  statuses: string[] | undefined
): string {
  let description = `employer "${companyNamePart}"`;
  if (titlePart !== undefined) description += ` and title "${titlePart}"`;
  if (statuses !== undefined) description += `, within ${statuses.join(", ")}`;
  return description;
}

// A job the pipeline has not finished with can reach here holding no title
// and no employer name. It still has to be nameable, because its id is the
// whole reason the user ran this.
function matchLine(job: JobSearchMatch): string {
  const title = job.title ?? "(no title)";
  const employer = job.company_name ?? "(no employer name)";
  const posted =
    job.posting_date === null ? "" : `, posted ${job.posting_date.toISOString().slice(0, 10)}`;
  return `  ${job.id}: ${title} at ${employer} — ${job.status}${posted}`;
}

// Shapes a match for --json. Same fields the service already returns, except
// location_match_place is renamed to location — the criterion and the resume
// skill both talk about the job's "location", not its "match place".
function toJsonMatch(job: JobSearchMatch) {
  return {
    id: job.id,
    title: job.title,
    company_name: job.company_name,
    status: job.status,
    posting_date: job.posting_date,
    original_url: job.original_url,
    resolved_url: job.resolved_url,
    location: job.location_match_place,
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const companyNamePart = flagValue(argv, "company");
  const jsonMode = argv.includes("--json");

  // Checked before the database is opened, so a missing flag leaves no side
  // effect to reason about.
  if (companyNamePart === undefined) {
    console.error("Missing required flag: --company <part of the employer's name>");
    process.exitCode = 1;
    return;
  }

  const titlePart = flagValue(argv, "title");
  const statuses = parseStatuses(flagValue(argv, "statuses"));

  const prisma = createPipelineDb();
  try {
    // The same check every other command runs, before anything is read. It
    // reads each table whole and reports only the table's name, which is why
    // the message names tables rather than columns.
    if (await schemaHasDrifted(schemaProbesFor(prisma))) {
      process.exitCode = 1;
      return;
    }

    const jobs = createJobService(prisma);

    // Only what was actually given is passed on. The service reads an absent
    // field as "do not narrow by this", which is not the same as narrowing by
    // an empty answer.
    const matches = await jobs.findByCompanyNameMatch({
      companyNamePart,
      ...(titlePart === undefined ? {} : { titlePart }),
      ...(statuses === undefined ? {} : { statuses }),
    });

    if (jsonMode) {
      // The resume skill parses this array instead of the printed lines
      // below — an empty search is a real, valid answer, not an error.
      console.log(JSON.stringify(matches.map(toJsonMatch), null, 2));
      return;
    }

    const searched = describeSearch(companyNamePart, titlePart, statuses);

    if (matches.length === 0) {
      // "no job matched" is a fixed phrase rather than a label anyone may
      // reword. The change-status skill reads it to tell an empty search from
      // a list of matches, and those two lead to different next steps.
      console.log(`no job matched ${searched}.`);
      return;
    }

    // The service already orders these most recently published first, so
    // sorting again here could only disagree with it.
    console.log(`Jobs matching ${searched}:`);
    for (const job of matches) {
      console.log(matchLine(job));
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
