// A stateful stand-in JobService for tests that create, update, and delete
// jobs without touching a database. Unlike the project's other fakes this
// one must remember what happened between calls, so it mirrors the real
// service's create, update and delete rules against the array the caller
// passed in — a job created by one call is then found by the next.
import { mergeJobs } from "./job-merge";
import type { JobListEntry } from "./job-list-entry";
import type { DeleteResult, JobService, UpdateResult } from "./job-service";
import { isActiveStatus } from "./job-status";
import { urlMatchKey } from "./url-match-key";

// A link's match key travels with the link: a string link gets a freshly
// computed key, a null link clears its key too, and a link this write never
// mentions leaves the held key standing — setting it would wipe a good key on
// a write that says nothing about that link. "Mentioned" is judged against the
// arriving entry, but the key is built from the link that won, so a link that
// lost the merge never writes its key over the winner's.
function writeLinkMatchKey(
  target: JobListEntry,
  keyField: "original_url_match_key" | "resolved_url_match_key",
  mentioned: string | null | undefined,
  winner: string | null | undefined
): void {
  if (mentioned === undefined) return;
  target[keyField] = typeof winner === "string" ? urlMatchKey(winner) : null;
}

export function fakeJobService(
  jobs: JobListEntry[] = [],
  overrides: Partial<JobService> = {}
): JobService {
  async function update(
    entry: JobListEntry,
    priorityList: readonly string[]
  ): Promise<UpdateResult> {
    if (!entry.id) {
      throw new Error("Job.update requires entry.id — it is how the row to update is found.");
    }

    const held = jobs.find((job) => job.id === entry.id);

    // A caller can be holding a stale copy of a job, so its created_at is
    // dropped before the entry is used — only the database sets a birthday.
    const incoming: JobListEntry = { ...entry };
    delete incoming.created_at;

    if (!held) {
      if (!entry.collected_at) {
        throw new Error(
          "Job.update cannot create a row without collected_at — the column has no database default."
        );
      }
      const job: JobListEntry = { ...incoming };
      // delete_on_save is not a column and must never end on a held job.
      delete job.delete_on_save;
      // The schema defaults status to backlog on a real insert, so a fake
      // holding plain objects has to supply that default itself.
      if (job.status === undefined) job.status = "backlog";
      writeLinkMatchKey(job, "original_url_match_key", entry.original_url, job.original_url);
      writeLinkMatchKey(job, "resolved_url_match_key", entry.resolved_url, job.resolved_url);
      // The database writes both timestamps on an insert.
      const now = new Date();
      job.created_at = now;
      job.modified_at = now;
      jobs.push(job);
      return { job, outcome: "created" };
    }

    if (isActiveStatus(held.status ?? "")) {
      // The user has applied to this job, so it is frozen except for its
      // status. Absent rather than falsy, the way the real service reads it.
      if (entry.status !== undefined) {
        held.status = entry.status;
        // A status-only write is still a write, so the row's clock moves.
        held.modified_at = new Date();
        return { job: held, outcome: "status_updated" };
      }
      // Nothing was written, so nothing moves.
      return { job: held, outcome: "unchanged" };
    }

    const merged = mergeJobs(held, incoming, priorityList, held.collected_at as Date);
    // Mutate the record in place so the caller's array reflects the write.
    Object.assign(held, merged);
    // Read the links off the merged record, so each key follows the link that
    // won the source-priority contest rather than the one the entry carried.
    writeLinkMatchKey(held, "original_url_match_key", entry.original_url, held.original_url);
    writeLinkMatchKey(held, "resolved_url_match_key", entry.resolved_url, held.resolved_url);
    // The database moves modified_at on every write and leaves the birthday be.
    held.modified_at = new Date();
    return { job: held, outcome: "updated" };
  }

  async function deleteJob(id: string): Promise<DeleteResult> {
    const index = jobs.findIndex((job) => job.id === id);
    if (index === -1) {
      return { deleted: false, blockedBy: null };
    }

    const held = jobs[index] as JobListEntry;
    // An active job carries the application history the user is acting on, so
    // a dedupe merge is refused rather than allowed to destroy it.
    if (isActiveStatus(held.status ?? "")) {
      return { deleted: false, blockedBy: held };
    }

    jobs.splice(index, 1);
    return { deleted: true, blockedBy: null };
  }

  // The three lookups dedupe's database compare runs, read off the held array
  // rather than a table. An equality test never matches an absent field, so a
  // held job carrying no key, no company or no title matches nothing — the
  // same answer the real column gives.
  async function findByOriginalUrlMatchKey(matchKey: string): Promise<JobListEntry[]> {
    return jobs.filter((job) => job.original_url_match_key === matchKey);
  }

  async function findByResolvedUrlMatchKey(matchKey: string): Promise<JobListEntry[]> {
    return jobs.filter((job) => job.resolved_url_match_key === matchKey);
  }

  async function findByCompanyAndTitle(companyId: string, title: string): Promise<JobListEntry[]> {
    return jobs.filter((job) => job.company_id === companyId && job.title === title);
  }

  // Both checks lean on the defaults the schema gives the real columns: a held
  // job saying nothing about its status is in the backlog, and one saying
  // nothing about its resolution is unresolved.
  async function findUnresolved(): Promise<JobListEntry[]> {
    return jobs
      .filter((job) => (job.status ?? "backlog") === "backlog" && !job.is_resolved)
      .map((job) => {
        // The four keys are dropped from the copy rather than set to
        // undefined, which is what Prisma's omit does on the real read. A key
        // left standing holds a stale copy of a flag another phase owns.
        const entry = { ...job };
        delete entry.status;
        delete entry.is_resolved;
        delete entry.is_parsed;
        delete entry.is_classified;
        return entry;
      });
  }

  return {
    update,
    delete: deleteJob,
    findByOriginalUrlMatchKey,
    findByResolvedUrlMatchKey,
    findByCompanyAndTitle,
    findUnresolved,
    ...overrides,
  };
}
