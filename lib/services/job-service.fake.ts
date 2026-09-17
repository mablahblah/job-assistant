// A stateful stand-in JobService for tests that create, update, and delete
// jobs without touching a database. Unlike the project's other fakes this
// one must remember what happened between calls, so it mirrors the real
// service's create, update and delete rules against the array the caller
// passed in — a job created by one call is then found by the next.
import { mergeJobs } from "../utils/job-merge";
import type { JobListEntry } from "../types/job-list-entry";
import type { DeleteResult, JobSearchMatch, JobService, UpdateResult } from "./job-service";
import { isActiveStatus } from "../utils/job-status";
import { urlMatchKey } from "../utils/url-match-key";
import { isPastThreshold, jobAgeInDays } from "../utils/job-age";

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

  // The four keys are dropped from the copy rather than set to undefined,
  // which is what Prisma's omit does on the real read. A key left standing
  // holds a stale copy of a flag another phase owns.
  function withoutGateFields(job: JobListEntry): JobListEntry {
    const entry = { ...job };
    delete entry.status;
    delete entry.is_resolved;
    delete entry.is_parsed;
    delete entry.is_classified;
    return entry;
  }

  // Both checks lean on the defaults the schema gives the real columns: a held
  // job saying nothing about its status is in the backlog, and one saying
  // nothing about its resolution is unresolved.
  async function findUnresolved(): Promise<JobListEntry[]> {
    return jobs
      .filter((job) => (job.status ?? "backlog") === "backlog" && !job.is_resolved)
      .map(withoutGateFields);
  }

  // A held job saying nothing about its resolution is unresolved, so it stays
  // off this list; it only joins once is_resolved is truthy and is_parsed is
  // still falsy.
  async function findUnparsed(): Promise<JobListEntry[]> {
    return jobs
      .filter(
        (job) => (job.status ?? "backlog") === "backlog" && !!job.is_resolved && !job.is_parsed
      )
      .map(withoutGateFields);
  }

  async function findBacklog(): Promise<JobListEntry[]> {
    return jobs.filter((job) => (job.status ?? "backlog") === "backlog").map(withoutGateFields);
  }

  // Hands the held job back whole, matching the real read, which leaves the
  // phase gate fields on too. Only the reads that build a job list for a save
  // strip them.
  async function findById(id: string): Promise<JobListEntry | null> {
    return jobs.find((job) => job.id === id) ?? null;
  }

  // A job with no collection date cannot have its age measured at all, so it
  // is left off rather than given a made-up one. A stored row always carries
  // the date, so only a hand-built job in a test can reach this.
  function hasCollectedAt(job: JobListEntry): job is JobListEntry & { collected_at: Date } {
    return job.collected_at instanceof Date;
  }

  async function findExpiredWithin(thresholdDays: number, now: Date): Promise<JobListEntry[]> {
    return jobs
      .filter((job) => job.status === "expired")
      .filter(hasCollectedAt)
      .filter((job) => !isPastThreshold(jobAgeInDays(job, now), thresholdDays))
      .map(withoutGateFields);
  }

  // Backlog and untouched by classification, but only once resolution and
  // parsing have both already happened.
  async function findUnclassified(): Promise<JobListEntry[]> {
    return jobs
      .filter(
        (job) =>
          (job.status ?? "backlog") === "backlog" &&
          !!job.is_resolved &&
          !!job.is_parsed &&
          !job.is_classified
      )
      .map(withoutGateFields);
  }

  // Backlog, carrying no alignment score, and past all three phase gates.
  // Mirrors the real query: a job an earlier run left unscored is picked up
  // rather than lost.
  async function findNeedingScores(): Promise<JobListEntry[]> {
    return jobs
      .filter(
        (job) =>
          (job.status ?? "backlog") === "backlog" &&
          job.alignment_score == null &&
          !!job.is_resolved &&
          !!job.is_parsed &&
          !!job.is_classified
      )
      .map(withoutGateFields);
  }

  // The real service joins to the Company table and matches Company.name.
  // This fake carries no employer table at all — the only employer text it
  // holds is raw_company_name, the name a collector wrote straight onto the
  // job — so that field stands in for it. A test that needs the stored
  // employer's name rather than the collected one belongs against the real
  // service.
  async function findByCompanyNameMatch(options: {
    companyNamePart: string;
    titlePart?: string;
    statuses?: readonly string[];
  }): Promise<JobSearchMatch[]> {
    const companyPart = options.companyNamePart.toLowerCase();
    const titlePart = options.titlePart?.toLowerCase();
    const statuses = options.statuses;

    return jobs
      .filter((job) => job.raw_company_name?.toLowerCase().includes(companyPart))
      .filter((job) => !titlePart || (job.title ?? "").toLowerCase().includes(titlePart))
      .filter((job) => !statuses?.length || statuses.includes(job.status ?? "backlog"))
      // filter already hands back a fresh array, so this sort never reaches
      // the array the caller passed in. Spelled out because sort mutates in
      // place, and a later edit dropping a filter would make it do so.
      .sort((a, b) => {
        // Mirrors SQLite's ordering for the real query: a job with no posting
        // date sorts below every job that has one.
        const aTime = a.posting_date?.getTime();
        const bTime = b.posting_date?.getTime();
        if (aTime == null && bTime == null) return 0;
        if (aTime == null) return 1;
        if (bTime == null) return -1;
        return bTime - aTime;
      })
      .map((job) => ({
        id: job.id ?? "",
        title: job.title || job.raw_title || null,
        company_name: job.raw_company_name ?? null,
        status: job.status ?? "backlog",
        posting_date: job.posting_date ?? null,
      }));
  }

  return {
    update,
    delete: deleteJob,
    findById,
    findByOriginalUrlMatchKey,
    findByResolvedUrlMatchKey,
    findByCompanyAndTitle,
    findUnresolved,
    findUnparsed,
    findBacklog,
    findExpiredWithin,
    findUnclassified,
    findNeedingScores,
    findByCompanyNameMatch,
    ...overrides,
  };
}
