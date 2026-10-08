// Owns every create, update and delete of the Job table, one row at a time.
// Nothing else in the codebase writes to Job — the save step, the update-job
// skill, the Web UI and scoring all go through the methods here, so the
// active-status freeze and the merge-on-arrival rules stay in one place
// instead of being re-solved at every call site.
import type { createPipelineDb } from "../db/pipeline-db";
import { Prisma } from "../../generated/pipeline/client";
import type { Job } from "../../generated/pipeline/client";
import type { JobListEntry } from "../types/job-list-entry";
import type { JobRow } from "../types/job-row";
import { COMPANY_RECORD_SELECT, toCompanyRecord, type CompanyRow } from "./company-service";
import { isActiveStatus } from "../utils/job-status";
import { mergeJobs, WRITE_ONCE_FIELDS } from "../utils/job-merge";
import { urlMatchKey } from "../utils/url-match-key";
import { isPastThreshold, jobAgeInDays } from "../utils/job-age";
import { poolJobDates } from "../utils/job-dates";

// What the write turned out to be, so a caller can trace it without working
// it out again from the row it got back.
export type JobWriteOutcome = "created" | "updated" | "status_updated" | "unchanged";

export interface UpdateResult {
  job: JobListEntry;
  outcome: JobWriteOutcome;
}

// Just enough of a job to name it back to the user. The change-status skill
// is handed an employer and roughly a role rather than an id, and this is
// what it shows when several jobs answer to those words.
export interface JobSearchMatch {
  id: string;
  title: string | null;
  company_name: string | null;
  status: string;
  posting_date: Date | null;
  // The resume skill fetches the posting by these links and tailors to the
  // location, through find-jobs' machine-readable answer.
  original_url: string | null;
  resolved_url: string | null;
  location_match_place: string | null;
}

export interface DeleteResult {
  deleted: boolean;
  // The active row that refused the delete, so the caller can warn naming it.
  blockedBy: JobListEntry | null;
}

export interface JobService {
  // An identifying query value must survive into the match key. This parameter
  // is required: omitting it would silently write match keys without the
  // identifying value (e.g., UltiPro's job ID), causing two different postings
  // to appear as one.
  update(
    entry: JobListEntry,
    priorityList: readonly string[],
    identifyingQueryValues: readonly string[]
  ): Promise<UpdateResult>;
  delete(id: string): Promise<DeleteResult>;
  // Reads one row and writes nothing. Update creates a row where it finds
  // none, and a status change carries no collection date, so that create
  // refuses with a message about a missing column — which names the wrong
  // fault when the real answer is that no job holds the id. A caller reads
  // here first and answers for itself.
  findById(id: string): Promise<JobListEntry | null>;
  // The three lookups dedupe's database compare runs. Each asks the table a
  // different question on an indexed column, so dedupe runs all three every
  // time and any of them can name a row the other two missed. They live here
  // because the step itself reaches no database of its own.
  findByOriginalUrlMatchKey(matchKey: string): Promise<JobListEntry[]>;
  findByResolvedUrlMatchKey(matchKey: string): Promise<JobListEntry[]>;
  findByCompanyAndTitle(companyId: string, title: string): Promise<JobListEntry[]>;
  // Resolution keeps no list of its own; this is where it reads one. Nothing
  // narrows it to a single run, so a job collected weeks ago and never
  // resolved is still on it. The five phase gates are left off every row,
  // because an entry carried on to dedupe and save should hold no stale copy
  // of a flag another phase owns.
  findUnresolved(): Promise<JobListEntry[]>;
  // Parsing keeps no list of its own either; this is where it reads one. A
  // job only qualifies once resolution has done its work and parsing has not
  // yet done its own, so an unresolved job and an already-parsed job are both
  // left off, along with one that took a status removing it from the queue on
  // an earlier run, such as unparseable. The five phase gates are left off
  // every row for the same reason as above.
  findUnparsed(): Promise<JobListEntry[]>;
  // Backlog cleanup reads its list here. It runs before any collector and
  // sweeps the whole backlog rather than one run's worth, because a job that
  // went stale weeks ago is as old today as one collected this morning. How
  // far through the pipeline a job has come makes no difference to how old it
  // is, so a resolved, parsed and judged job sits on this list beside one
  // nothing has touched yet. The five phase gates are left off every row,
  // because an entry carried on to a save should hold no stale copy of a flag
  // another phase owns.
  findBacklog(): Promise<JobListEntry[]>;
  // The add-external-jobs runner reads back only the jobs it was handed, so
  // other waiting jobs are left alone, and only those still in the backlog, as
  // every later step of a job search reads only backlog jobs. The step names
  // which single gate flag must still be false — resolution checks
  // is_resolved, parsing checks is_parsed, classification checks
  // is_classified — and never the gates the other steps own. Gate fields are
  // left off, as findBacklog does.
  findBacklogByIds(ids: readonly string[], step: BacklogStep): Promise<JobListEntry[]>;
  // Promotion reads its list here, and returns these jobs to the backlog
  // because an employer that lists a role again gives it a fresh date, which
  // pulls its age back inside the threshold. The age rule lives in one
  // function the whole pipeline shares, and SQL cannot ask it anything, so the
  // expired rows come back whole and the narrowing happens in code. The
  // reference instant is handed in rather than read off the clock, because a
  // run can spend half an hour in a browser between its first age check and
  // its last, and every job on one run is measured against the same moment.
  // The five phase gates are left off every row for the same reason as above.
  findExpiredWithin(thresholdDays: number, now: Date): Promise<JobListEntry[]>;
  // Classification reads its list here. A job only qualifies once resolution
  // and parsing have both finished with it, since there is nothing to judge
  // before then, and once judged it is done, so an already-classified job and
  // one that took a status removing it from the queue are both left off. The
  // five phase gates are left off every row for the same reason as above.
  findNeedingScores(): Promise<JobListEntry[]>;
  findUnclassified(): Promise<JobListEntry[]>;
  // Crosses the Company relation and reports on the employer rather than the
  // full job row, so it returns its own shape instead of bending toward
  // JobListEntry the way every other read here does. An empty or absent
  // status list means every status, because the caller that narrows by status
  // is the skill, and a caller with no reason to narrow should not have to
  // name all twelve.
  findByCompanyNameMatch(options: {
    companyNamePart: string;
    statuses?: readonly string[];
  }): Promise<JobSearchMatch[]>;
  // Follows a job's collected or resolved link back to every row sharing that
  // match key. A single OR query already returns a row once even when both
  // columns match, so no row is named twice. Shares the same status-filter
  // rule as findByCompanyNameMatch: an empty or absent list means every
  // status.
  findByUrlMatchKey(options: {
    matchKey: string;
    statuses?: readonly string[];
  }): Promise<JobSearchMatch[]>;
  // The dashboard's two reads. Each hands back the job and its employer side
  // by side rather than merged, because the job shape already mirrors the Job
  // row exactly and a merged shape would be a third field list to keep in step
  // with both. The employer has to come along: four of the five ratings behind
  // a job's total sit on it, and the total is worked out as the page is built
  // rather than read from a column.
  //
  // Neither read orders its rows. The three page lists sort differently from
  // each other, so the sorting belongs where that difference lives.
  //
  // A list covering no status hands back nothing rather than everything.
  // Reading the whole table would put every job under a heading that promised
  // one status.
  findByStatuses(statuses: readonly string[]): Promise<JobRow[]>;
  // The work log names its jobs by id, and the employer's contact details are
  // only reachable through the job. An id no job holds is expected rather than
  // an error, because an entry is built to outlive the job it names, so it is
  // simply absent from what comes back.
  findByIds(ids: readonly string[]): Promise<JobRow[]>;
}

type PipelineDb = ReturnType<typeof createPipelineDb>;

// The five phase gates, left off every job list that feeds a save. Each gate
// belongs to one phase, and an entry carried on to a save must hold no stale
// copy of one another phase owns.
const GATE_FIELDS = {
  status: true,
  is_resolved: true,
  is_parsed: true,
  is_classified: true,
  is_judged: true,
} satisfies Prisma.JobOmit;

// The field list behind every JobSearchMatch answer. Both reads that return
// this shape select through this one const, so a field added or dropped
// cannot land in one read's answer without landing in the other's.
const JOB_SEARCH_MATCH_SELECT = {
  id: true,
  title: true,
  raw_title: true,
  status: true,
  posting_date: true,
  company: { select: { name: true } },
  original_url: true,
  resolved_url: true,
  location_match_place: true,
} satisfies Prisma.JobSelect;

// A job normalization has not reached yet still has to be nameable, so
// the published title stands in where the tidied one is empty.
function toJobSearchMatch(
  row: Prisma.JobGetPayload<{ select: typeof JOB_SEARCH_MATCH_SELECT }>
): JobSearchMatch {
  return {
    id: row.id,
    title: row.title ?? row.raw_title,
    company_name: row.company?.name ?? null,
    status: row.status,
    posting_date: row.posting_date,
    original_url: row.original_url,
    resolved_url: row.resolved_url,
    location_match_place: row.location_match_place,
  };
}

// Shared by every read that lets a caller narrow by status. An empty or
// absent list means every status, because a caller with no reason to narrow
// should not have to name all twelve.
function statusWhereClause(
  statuses?: readonly string[]
): Pick<Prisma.JobWhereInput, "status"> {
  return statuses && statuses.length > 0 ? { status: { in: [...statuses] } } : {};
}

// Which phase gate a caller is about to run, so findBacklogByIds knows which flag to check.
export type BacklogStep = "resolution" | "parsing" | "classification";

// The one unchecked flag for each step — resolution only needs resolving,
// parsing reads whatever came back whether or not resolution worked, and
// classification doesn't care how the job got read. Shared with the stand-in
// service, so the two cannot disagree about which flag a step checks.
export const STEP_GATES = {
  resolution: { is_resolved: false },
  parsing: { is_parsed: false },
  classification: { is_classified: false },
} satisfies Record<BacklogStep, Prisma.JobWhereInput>;

// Under this project's libsql driver adapter, a unique-constraint violation
// arrives without meta.target, so the error only tells us that a write
// collided. Job has one unique column, its id, so that is all we need.
function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

// The Job row maps one to one onto JobListEntry; Prisma just types the four
// Json columns as JsonValue instead of the array or object shape they
// actually hold. This is the single documented cast that bridges the two.
function toJobListEntry(row: Job): JobListEntry {
  return row as unknown as JobListEntry;
}

// One row read with its employer alongside. The relation is optional, so a
// job company association never matched comes back with nothing in the
// employer's place rather than being left out of the list.
function toJobRow(row: Job & { company: CompanyRow | null }): JobRow {
  const { company, ...job } = row;
  return {
    job: toJobListEntry(job as Job),
    company: company === null ? null : toCompanyRecord(company),
  };
}

// A link's match key travels with it: a string link gets a freshly computed
// key, a null link clears its key too, and a link this write never mentions
// leaves the stored key standing — setting it would wipe a good key on a
// write that says nothing about that link.
function writeLinkMatchKey(
  columns: Record<string, unknown>,
  keyField: string,
  link: string | null | undefined,
  identifyingQueryValues: readonly string[]
): void {
  if (link === undefined) return;
  columns[keyField] = link === null ? null : urlMatchKey(link, identifyingQueryValues);
}

// delete_on_save is a JobListEntry-only flag, not a Job column, so it is
// stripped before the rest of the entry reaches Prisma. created_at is stripped
// too: a merged job carries the surviving row's created_at while it travels in
// memory, and writing it back would overwrite the birthday the database set.
function toColumnData(
  entry: JobListEntry,
  identifyingQueryValues: readonly string[]
): Record<string, unknown> {
  const columns: Record<string, unknown> = { ...entry };
  delete columns["delete_on_save"];
  delete columns["created_at"];
  writeLinkMatchKey(columns, "original_url_match_key", entry.original_url, identifyingQueryValues);
  writeLinkMatchKey(columns, "resolved_url_match_key", entry.resolved_url, identifyingQueryValues);
  return columns;
}

export function createJobService(db: PipelineDb): JobService {
  // The row is written with the id the job was given at collection, because a
  // trace naming that id has to point at a row that exists.
  async function create(
    id: string,
    entry: JobListEntry,
    priorityList: readonly string[],
    identifyingQueryValues: readonly string[]
  ): Promise<UpdateResult> {
    if (entry.collected_at == null) {
      throw new Error(
        "Job.update cannot create a row without collected_at — the column has no database default."
      );
    }

    // A first-ever save never merges, so this is the only place a brand-new
    // job has its dates pooled. Pooling against no second side still runs the
    // collection-date fallback, so a job carrying no posting date anywhere
    // still leaves save with one.
    const { posting_date, posting_updated_date } = poolJobDates(entry, null, entry.collected_at);
    const columns = {
      ...toColumnData(entry, identifyingQueryValues),
      posting_date,
      posting_updated_date,
    };

    try {
      const row = await db.job.create({ data: columns as Prisma.JobCreateInput });
      return { job: toJobListEntry(row), outcome: "created" };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      // Another save took this id between the lookup and this write. Recover
      // by taking the update path against that row, as if the lookup had
      // found it in the first place.
      const row = await db.job.findUnique({ where: { id } });
      return writeToExistingRow(id, row, entry, priorityList, identifyingQueryValues);
    }
  }

  async function writeToExistingRow(
    id: string,
    row: Job | null,
    entry: JobListEntry,
    priorityList: readonly string[],
    identifyingQueryValues: readonly string[]
  ): Promise<UpdateResult> {
    // The user has applied to this job, so everything about it is frozen
    // except its status. An entry carrying none leaves the row alone.
    if (row && isActiveStatus(row.status)) {
      if (entry.status === undefined) {
        return { job: toJobListEntry(row), outcome: "unchanged" };
      }
      const updated = await db.job.update({ where: { id }, data: { status: entry.status } });
      return { job: toJobListEntry(updated), outcome: "status_updated" };
    }

    // A null row reaches here only from the race above, where the row is
    // known to exist but could not be read back. Merging against an empty
    // side degrades safely: the arriving entry's fields win and the rest are
    // absent from the write, which Prisma leaves alone.
    const stored = row ? toJobListEntry(row) : {};
    const collectedAt = row ? row.collected_at : (entry.collected_at as Date);
    const merged = mergeJobs(stored, entry, priorityList, collectedAt);

    // mergeJobs always hands back the write-once fields, so they are dropped
    // here rather than named again — the merge is where that group is defined.
    const data = toColumnData(merged, identifyingQueryValues);
    for (const field of WRITE_ONCE_FIELDS) delete data[field];
    const updated = await db.job.update({ where: { id }, data: data as Prisma.JobUpdateInput });
    return { job: toJobListEntry(updated), outcome: "updated" };
  }

  // Shared by the three lookups below: run one findMany against the clause it
  // is handed and give every row back through the usual conversion.
  async function findManyAsEntries(where: Prisma.JobWhereInput): Promise<JobListEntry[]> {
    const rows = await db.job.findMany({ where });
    return rows.map(toJobListEntry);
  }

  return {
    async update(entry, priorityList, identifyingQueryValues) {
      if (!entry.id) {
        throw new Error("Job.update requires entry.id — it is how the row to update is found.");
      }

      const row = await db.job.findUnique({ where: { id: entry.id } });
      if (!row) return create(entry.id, entry, priorityList, identifyingQueryValues);
      return writeToExistingRow(entry.id, row, entry, priorityList, identifyingQueryValues);
    },

    async delete(id) {
      const row = await db.job.findUnique({ where: { id } });
      if (!row) return { deleted: false, blockedBy: null };

      // An active row carries the application history the user is acting on,
      // so a dedupe merge is refused rather than allowed to destroy it.
      if (isActiveStatus(row.status)) {
        return { deleted: false, blockedBy: toJobListEntry(row) };
      }

      await db.job.delete({ where: { id } });
      return { deleted: true, blockedBy: null };
    },

    // The phase gate fields stay on the row here, unlike the job-list reads
    // below. Those strip them because their entries are carried on to a save
    // and must hold no stale copy of a flag another phase owns; this hands
    // back one whole row for a caller to look at.
    async findById(id) {
      const row = await db.job.findUnique({ where: { id } });
      return row ? toJobListEntry(row) : null;
    },

    // Both match-key columns are indexed and neither is unique, so several
    // rows can hold one key — every match comes back, not just the first.
    findByOriginalUrlMatchKey(matchKey) {
      return findManyAsEntries({ original_url_match_key: matchKey });
    },

    findByResolvedUrlMatchKey(matchKey) {
      return findManyAsEntries({ resolved_url_match_key: matchKey });
    },

    // The third clause reaches a stored row that shares neither link with the
    // entry looking for it. Whether the two sides' dates are close enough to
    // count as one job is the identity rules' question, not this one's.
    findByCompanyAndTitle(companyId, title) {
      return findManyAsEntries({ company_id: companyId, title });
    },

    // findManyAsEntries hands every row to toJobListEntry, which takes a whole
    // Job. Omitting the gate fields narrows the row below that type, so this
    // read runs its own query and casts the narrower row itself rather than
    // bending the shared helper.
    async findUnresolved() {
      const rows = await db.job.findMany({
        where: { status: "backlog", is_resolved: false },
        omit: GATE_FIELDS,
      });
      return rows.map((row) => row as unknown as JobListEntry);
    },

    // The same narrowing as findUnresolved, but for the other side of
    // resolution: only a job resolution has already finished with, and
    // parsing has not yet touched, belongs on this list.
    async findUnparsed() {
      const rows = await db.job.findMany({
        where: { status: "backlog", is_resolved: true, is_parsed: false },
        omit: GATE_FIELDS,
      });
      return rows.map((row) => row as unknown as JobListEntry);
    },

    // The same narrowing as findUnresolved, with nothing beyond the status
    // asked of the row, because cleanup judges the whole backlog in one pass.
    async findBacklog() {
      const rows = await db.job.findMany({
        where: { status: "backlog" },
        omit: GATE_FIELDS,
      });
      return rows.map((row) => row as unknown as JobListEntry);
    },

    async findBacklogByIds(ids, step) {
      if (ids.length === 0) return [];
      const rows = await db.job.findMany({
        where: { id: { in: [...ids] }, status: "backlog", ...STEP_GATES[step] },
        omit: GATE_FIELDS,
      });
      return rows.map((row) => row as unknown as JobListEntry);
    },

    // The age check runs on the row as the database hands it back, before the
    // cast below loosens every field, because an age can only be measured from
    // a date that is really there. A job inside the threshold is one that is
    // not past it.
    async findExpiredWithin(thresholdDays, now) {
      const rows = await db.job.findMany({
        where: { status: "expired" },
        omit: GATE_FIELDS,
      });
      return rows
        .filter((row) => !isPastThreshold(jobAgeInDays(row, now), thresholdDays))
        .map((row) => row as unknown as JobListEntry);
    },

    // The same narrowing as findUnparsed, one step further along the pipeline.
    async findNeedingScores() {
      const rows = await db.job.findMany({
        where: {
          status: "backlog",
          alignment_score: null,
          is_resolved: true,
          is_parsed: true,
          is_classified: true,
        },
        // Four of the five gates are pinned by the where clause, so every row
        // would carry the same values and tell scoring nothing it does not
        // already know. The judged marker goes for the stale-copy reason every
        // list shares. The score column stays, because scoring fills it in on
        // the entry it was handed and needs somewhere to put the number.
        omit: GATE_FIELDS,
      });
      return rows.map((row) => row as unknown as JobListEntry);
    },

    async findUnclassified() {
      const rows = await db.job.findMany({
        where: { status: "backlog", is_resolved: true, is_parsed: true, is_classified: false },
        omit: GATE_FIELDS,
      });
      return rows.map((row) => row as unknown as JobListEntry);
    },

    // `contains` compiles to SQLite's LIKE, which is already case-insensitive
    // for ASCII, so the user typing "figma" or "FIGMA" reaches the same rows.
    // Prisma's SQLite provider rejects `mode: "insensitive"` outright, so
    // neither is asked for here.
    async findByCompanyNameMatch({ companyNamePart, statuses }) {
      const rows = await db.job.findMany({
        where: {
          company: { name: { contains: companyNamePart } },
          ...statusWhereClause(statuses),
        },
        select: JOB_SEARCH_MATCH_SELECT,
        // SQLite sorts null below every real value, so descending order
        // already sinks a job with no posting date beneath the dated ones
        // rather than letting it head the list.
        orderBy: { posting_date: "desc" },
      });

      return rows.map(toJobSearchMatch);
    },

    // A job matches on its collected link, its resolved link, or both; the OR
    // clause asks SQLite for either column in one findMany, so a job with
    // both pointing at the same key still comes back once rather than twice.
    async findByUrlMatchKey({ matchKey, statuses }) {
      const rows = await db.job.findMany({
        where: {
          OR: [
            { original_url_match_key: matchKey },
            { resolved_url_match_key: matchKey },
          ],
          ...statusWhereClause(statuses),
        },
        select: JOB_SEARCH_MATCH_SELECT,
        orderBy: { posting_date: "desc" },
      });

      return rows.map(toJobSearchMatch);
    },

    async findByStatuses(statuses) {
      if (statuses.length === 0) return [];
      const rows = await db.job.findMany({
        where: { status: { in: [...statuses] } },
        include: { company: { select: COMPANY_RECORD_SELECT } },
      });
      return rows.map(toJobRow);
    },

    async findByIds(ids) {
      if (ids.length === 0) return [];
      const rows = await db.job.findMany({
        where: { id: { in: [...ids] } },
        include: { company: { select: COMPANY_RECORD_SELECT } },
      });
      return rows.map(toJobRow);
    },
  };
}
