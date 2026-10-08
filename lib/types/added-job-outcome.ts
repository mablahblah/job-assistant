// Where one link handed to the add-external-jobs run ended up. The runner
// builds one per link, in the order the links were handed over, and the
// report turns each into a printed line.
export type AddedJobOutcome = SavedJobOutcome | UnsavedJobOutcome;

// A link that became a job.
export interface SavedJobOutcome {
  link: string;
  jobId: string;
  title: string | null;
  employer: string | null;
  status: string | null;
  // The last reason this run recorded for the job. Null at `backlog`, where
  // nothing needs explaining.
  reason: string | null;
  // Every reason the run let the job through without judging it, including
  // why its link could not be followed. Empty for a job that was judged.
  letThroughReasons: string[];
}

// A link that became no job: it was refused as not a web address, or its
// save failed. Either way the user is told which, so the reason is never
// missing.
export interface UnsavedJobOutcome {
  link: string;
  jobId: null;
  title: string | null;
  employer: string | null;
  status: null;
  reason: string;
  letThroughReasons: [];
}
