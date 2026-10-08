// Finds the jobs the user means. Every other job command needs an id, and the
// user has none: a person names a job by pasting its link or by naming who is
// hiring. The link is tried first, because it can point at one exact job. When
// it points at nothing, the employer's jobs are the answer instead. The role
// is never searched here: the agent reads the employer's jobs and picks the
// one the user's role words describe.
//
// It only reads. Nothing here writes, which is why a run that matches nothing
// is an ordinary answer rather than a failure.
import { createPipelineDb } from "../lib/db/pipeline-db";
import { schemaProbesFor } from "../lib/db/schema-check";
import { schemaHasDrifted } from "../lib/db/schema-drift";
import { createJobService, type JobSearchMatch, type JobService } from "../lib/services/job-service";
import { createSettingsService } from "../lib/services/settings-service";
import { flagValue } from "../lib/utils/cli-args";
import { urlMatchKey } from "../lib/utils/url-match-key";

type FoundBy = "link" | "employer";
type LinkProblem = "no_match" | "not_a_link";
type StatusNarrowing = { statuses?: readonly string[] };
type JsonMatch = ReturnType<typeof toJsonMatch>;

// The one JSON object this command prints, which the skills read.
interface Answer {
  found_by: FoundBy;
  link_problem: LinkProblem | null;
  jobs: JsonMatch[];
}

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

// Shapes a match for the printed answer. Same fields the service already
// returns, except location_match_place is renamed to location — the criterion
// and the resume skill both talk about the job's "location", not its "match
// place".
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

// The link step runs first and either answers outright or leaves behind why it
// could not. matchKey is undefined when no link was given, and null when the
// text given was not a web address. The employer search then runs once, when
// an employer was named. With no employer, the answer is the link's problem and
// an empty list.
async function findJobs(
  jobs: JobService,
  search: { matchKey: string | null | undefined; companyNamePart: string | undefined; narrowing: StatusNarrowing },
): Promise<Answer> {
  const { matchKey, companyNamePart, narrowing } = search;
  let linkProblem: LinkProblem | null = null;
  if (matchKey === null) {
    linkProblem = "not_a_link";
  } else if (matchKey !== undefined) {
    const linked = await jobs.findByUrlMatchKey({ matchKey, ...narrowing });
    if (linked.length > 0) return { found_by: "link", link_problem: null, jobs: linked.map(toJsonMatch) };
    linkProblem = "no_match";
  }

  if (companyNamePart === undefined) return { found_by: "link", link_problem: linkProblem, jobs: [] };
  const employed = await jobs.findByCompanyNameMatch({ companyNamePart, ...narrowing });
  return { found_by: "employer", link_problem: linkProblem, jobs: employed.map(toJsonMatch) };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const link = flagValue(argv, "url");
  const companyNamePart = flagValue(argv, "company");
  // Checked before the database is opened, so a missing flag leaves no side
  // effect to reason about.
  if (link === undefined && companyNamePart === undefined) {
    console.error("Missing a job to look for: pass --url <link> or --company <part of the employer's name>");
    process.exitCode = 1;
    return;
  }
  const statuses = parseStatuses(flagValue(argv, "statuses"));
  // Only what was actually given is passed on. The service reads an absent
  // field as "do not narrow by this", which is not the same as narrowing by
  // an empty answer.
  const narrowing: StatusNarrowing = statuses === undefined ? {} : { statuses };

  const prisma = createPipelineDb();
  try {
    // The same check every other command runs, before anything is read. It
    // reads each table whole and reports only the table's name, which is why
    // the message names tables rather than columns.
    if (await schemaHasDrifted(schemaProbesFor(prisma))) {
      process.exitCode = 1;
      return;
    }
    // The link is cleaned the same way the stored links were, so tracking
    // values tacked on by a share button do not stop it matching. The settings
    // row is read only when there is a link to clean.
    const matchKey =
      link === undefined
        ? undefined
        : urlMatchKey(link, await createSettingsService(prisma).getIdentifyingQueryValues());
    const answer = await findJobs(createJobService(prisma), { matchKey, companyNamePart, narrowing });
    console.log(JSON.stringify(answer, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
