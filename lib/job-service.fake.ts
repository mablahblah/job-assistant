// A stateful stand-in JobService for tests that create, update, and delete
// jobs without touching a database. Unlike the project's other fakes this
// one must remember what happened between calls, so it mirrors the real
// service's create, update and delete rules against the array the caller
// passed in — a job created by one call is then found by the next.
import { mergeJobs } from "./job-merge";
import type { JobListEntry } from "./job-list-entry";
import type { DeleteResult, JobService, UpdateResult } from "./job-service";
import { isActiveStatus } from "./job-status";

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

    if (!held) {
      if (!entry.collected_at) {
        throw new Error(
          "Job.update cannot create a row without collected_at — the column has no database default."
        );
      }
      const job: JobListEntry = { ...entry };
      // delete_on_save is not a column and must never land on a held job.
      delete job.delete_on_save;
      // The schema defaults status to backlog on a real insert, so a fake
      // holding plain objects has to supply that default itself.
      if (job.status === undefined) job.status = "backlog";
      jobs.push(job);
      return { job, outcome: "created" };
    }

    if (isActiveStatus(held.status ?? "")) {
      // The user has applied to this job, so it is frozen except for its
      // status. Absent rather than falsy, the way the real service reads it.
      if (entry.status !== undefined) {
        held.status = entry.status;
        return { job: held, outcome: "status_updated" };
      }
      return { job: held, outcome: "unchanged" };
    }

    const merged = mergeJobs(held, entry, priorityList, held.collected_at as Date);
    // Mutate the record in place so the caller's array reflects the write.
    Object.assign(held, merged);
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

  return {
    update,
    delete: deleteJob,
    ...overrides,
  };
}
