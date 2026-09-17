// Starts the read-only job dashboard. The page shows what the pipeline has
// already decided, so this command owns almost nothing of its own: it gathers
// the four lists and hands the server tool a way to read them.
//
// The schema check lives inside the server rather than here, unlike every
// other command, because a dashboard has to refuse to listen rather than
// merely exit.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPipelineDb } from "../lib/db/pipeline-db";
import { schemaProbesFor } from "../lib/db/schema-check";
import { createJobService, type JobService } from "../lib/services/job-service";
import { createWorkLogService, type WorkLogService } from "../lib/services/work-log-service";
import { createWebServer } from "../lib/tools/web-server";
import type { WorkLogRow } from "../lib/types/work-log-row";
import { ACTIVE_STATUSES, RULED_OUT_STATUSES } from "../lib/utils/job-status";
import type { PageContents } from "../lib/views/page";

// The port the project's own serve config already names.
const DEFAULT_PORT = 3001;

// The three status lists are read from the one file that declares them rather
// than named again here, so the page and the pipeline cannot disagree about
// what a list covers.
export async function readPageContents(
  jobs: JobService,
  workLog: WorkLogService
): Promise<PageContents> {
  const [backlog, active, disqualified, entries] = await Promise.all([
    jobs.findByStatuses(["backlog"]),
    jobs.findByStatuses(ACTIVE_STATUSES),
    jobs.findByStatuses(RULED_OUT_STATUSES),
    workLog.findAll(),
  ]);

  // An entry copies the employer's name at the moment it is filed, but never
  // the contact details, which a search finds later. So the employer is read
  // through the job the entry names — once for every entry, not once each.
  const named = Array.from(new Set(entries.map((entry) => entry.job_id)));
  const linked = await jobs.findByIds(named);
  const employerByJobId = new Map(linked.map((row) => [row.job.id, row.company]));

  const workLogRows: WorkLogRow[] = entries.map((entry) => ({
    entry,
    // An entry is built to outlive the job it names, so a job that has gone
    // reads as details not found rather than as an error.
    company: employerByJobId.get(entry.job_id) ?? null,
  }));

  return { backlog, active, disqualified, workLog: workLogRows };
}

// An unset, empty or unreadable value falls back rather than becoming port 0,
// which would put the dashboard on a port nobody was told about.
function portFromEnvironment(): number {
  const asked = Number(process.env.PORT);
  return Number.isInteger(asked) && asked > 0 ? asked : DEFAULT_PORT;
}

async function main(): Promise<void> {
  const prisma = createPipelineDb();
  const jobs = createJobService(prisma);
  const workLog = createWorkLogService(prisma);

  const server = createWebServer({
    readContents: () => readPageContents(jobs, workLog),
    probes: schemaProbesFor(prisma),
    publicDir: resolve(dirname(fileURLToPath(import.meta.url)), "..", "public"),
  });

  if (!(await server.start(portFromEnvironment()))) {
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  // The database is left open on purpose. Unlike every other command here,
  // this one never finishes a task — it goes on answering requests until it
  // is stopped by hand.
}

void main();
