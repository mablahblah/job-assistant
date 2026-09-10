// Owns every create, update and delete of the Job table, one row at a time.
// Nothing else in the codebase writes to Job — the save step, the update-job
// skill, the Web UI and scoring all go through the methods here, so the
// active-status freeze and the merge-on-arrival rules stay in one place
// instead of being re-solved at every call site.
import type { createPipelineDb } from "./pipeline-db";
import { Prisma } from "../generated/pipeline/client";
import type { Job } from "../generated/pipeline/client";
import type { JobListEntry } from "./job-list-entry";
import { isActiveStatus } from "./job-status";
import { mergeJobs, WRITE_ONCE_FIELDS } from "./job-merge";
import { urlMatchKey } from "./url-match-key";

// What the write turned out to be, so a caller can trace it without working
// it out again from the row it got back.
export type JobWriteOutcome = "created" | "updated" | "status_updated" | "unchanged";

export interface UpdateResult {
  job: JobListEntry;
  outcome: JobWriteOutcome;
}

export interface DeleteResult {
  deleted: boolean;
  // The active row that refused the delete, so the caller can warn naming it.
  blockedBy: JobListEntry | null;
}

export interface JobService {
  update(entry: JobListEntry, priorityList: readonly string[]): Promise<UpdateResult>;
  delete(id: string): Promise<DeleteResult>;
  // The three lookups dedupe's database compare runs. Each asks the table a
  // different question on an indexed column, so dedupe runs all three every
  // time and any of them can name a row the other two missed. They live here
  // because the step itself reaches no database of its own.
  findByOriginalUrlMatchKey(matchKey: string): Promise<JobListEntry[]>;
  findByResolvedUrlMatchKey(matchKey: string): Promise<JobListEntry[]>;
  findByCompanyAndTitle(companyId: string, title: string): Promise<JobListEntry[]>;
}

type PipelineDb = ReturnType<typeof createPipelineDb>;

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

// A link's match key travels with it: a string link gets a freshly computed
// key, a null link clears its key too, and a link this write never mentions
// leaves the stored key standing — setting it would wipe a good key on a
// write that says nothing about that link.
function stampLinkMatchKey(
  columns: Record<string, unknown>,
  keyField: string,
  link: string | null | undefined
): void {
  if (link === undefined) return;
  columns[keyField] = link === null ? null : urlMatchKey(link);
}

// delete_on_save is a JobListEntry-only flag, not a Job column, so it is
// stripped before the rest of the entry reaches Prisma. created_at is stripped
// too: a merged job carries the surviving row's created_at while it travels in
// memory, and writing it back would overwrite the birthday the database set.
function toColumnData(entry: JobListEntry): Record<string, unknown> {
  const columns: Record<string, unknown> = { ...entry };
  delete columns["delete_on_save"];
  delete columns["created_at"];
  stampLinkMatchKey(columns, "original_url_match_key", entry.original_url);
  stampLinkMatchKey(columns, "resolved_url_match_key", entry.resolved_url);
  return columns;
}

export function createJobService(db: PipelineDb): JobService {
  // The row is written with the id the job was given at collection, because a
  // trace naming that id has to point at a row that exists.
  async function create(
    id: string,
    entry: JobListEntry,
    priorityList: readonly string[]
  ): Promise<UpdateResult> {
    if (entry.collected_at == null) {
      throw new Error(
        "Job.update cannot create a row without collected_at — the column has no database default."
      );
    }

    try {
      const row = await db.job.create({ data: toColumnData(entry) as Prisma.JobCreateInput });
      return { job: toJobListEntry(row), outcome: "created" };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      // Another save took this id between the lookup and this write. Recover
      // by taking the update path against that row, as if the lookup had
      // found it in the first place.
      const row = await db.job.findUnique({ where: { id } });
      return writeToExistingRow(id, row, entry, priorityList);
    }
  }

  async function writeToExistingRow(
    id: string,
    row: Job | null,
    entry: JobListEntry,
    priorityList: readonly string[]
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
    const data = toColumnData(merged);
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
    async update(entry, priorityList) {
      if (!entry.id) {
        throw new Error("Job.update requires entry.id — it is how the row to update is found.");
      }

      const row = await db.job.findUnique({ where: { id: entry.id } });
      if (!row) return create(entry.id, entry, priorityList);
      return writeToExistingRow(entry.id, row, entry, priorityList);
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
  };
}
