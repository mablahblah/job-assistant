// Sweeps the backlog before a run collects anything, marking every job that
// has aged past the expiry threshold as expired and leaving the rest exactly
// as they were. It opens the run so that the backlog being added to has
// already been swept.
//
// The threshold and the instant to measure against both arrive as arguments
// rather than being read from settings or the clock. A run can spend half an
// hour in a browser between its first age check and its last, and every job
// in one run is judged against the moment the run started, so a job sitting
// exactly on the line waits for the next run rather than being judged twice
// by two clocks.
//
// Age is measured by jobAgeInDays, which already decides which of a job's
// dates is the one to count from. This step only asks whether that age has
// crossed the line, and what to write down about the answer.

import { isPastThreshold, jobAgeInDays } from "../utils/job-age";
import type { JobListEntry } from "../types/job-list-entry";
import type { TraceService } from "../services/trace-service";
import {
  SCORE_CATEGORIES,
  type CompanyRecord,
  type ScoreCategory,
} from "../services/company-service";
import { DAY_MS } from "../utils/durations";

export interface CleanBacklogJobsOptions {
  expiryThresholdDays: number;
  referenceInstant: Date;
  trace?: TraceService;
  runId?: string;
  step?: string;
}

export interface CleanBacklogJobsResult {
  jobs: JobListEntry[];
}

// The entering row and the outcome row, in the order they are written, so a
// heading in the run summary can say what the step was handed even where the
// step later died. Typed as a closed set rather than plain strings, so a word
// this step has no right to write fails to compile.
interface BacklogCleanupEvent {
  event: "job_entered" | "job_kept" | "job_expired";
  reason?: "past_expiration_threshold";
}

interface CleanedBacklogJob {
  job: JobListEntry;
  events: BacklogCleanupEvent[];
}

// Judges one job. JobListEntry types every field as optional because it is a
// partial of the database row, but collected_at is a required column, so a
// job read back off the backlog always carries one. The fallback exists to
// satisfy the type rather than to cover a real case, and it reads an undated
// job as collected this instant, which keeps it in the backlog — missing data
// is never on its own a reason to expire a job.
function cleanBacklogJob(
  job: JobListEntry,
  expiryThresholdDays: number,
  referenceInstant: Date
): CleanedBacklogJob {
  const ageInDays = jobAgeInDays(
    {
      posting_date: job.posting_date,
      posting_updated_date: job.posting_updated_date,
      collected_at: job.collected_at ?? referenceInstant,
    },
    referenceInstant
  );

  if (isPastThreshold(ageInDays, expiryThresholdDays)) {
    // A copy, so the job handed in is never touched. Only the status moves:
    // nothing else about an expired job has changed.
    return {
      job: { ...job, status: "expired" },
      events: [{ event: "job_entered" }, { event: "job_expired", reason: "past_expiration_threshold" }],
    };
  }

  return {
    job,
    events: [{ event: "job_entered" }, { event: "job_kept" }],
  };
}

// The step wrapper around cleanBacklogJob: calls it once per entry and writes
// its rows through the trace service. It raises no warnings, because nothing
// here is something the user has to be told about — a job ageing out is the
// step working, not a problem with it.
export async function cleanBacklogJobs(
  jobs: JobListEntry[],
  options: CleanBacklogJobsOptions
): Promise<CleanBacklogJobsResult> {
  const { expiryThresholdDays, referenceInstant, trace, runId, step } = options;
  const cleanedJobs: JobListEntry[] = [];

  for (const job of jobs) {
    const { job: cleanedJob, events } = cleanBacklogJob(job, expiryThresholdDays, referenceInstant);
    cleanedJobs.push(cleanedJob);

    // A trace row is keyed by job id and collector, so a job carrying neither
    // has nothing to key its record on and is judged without leaving a record.
    if (!job.id || !job.collector) continue;

    for (const event of events) {
      // All three of trace, runId and step are needed before a row is
      // written. A step handed only some of them still does its work and
      // stays silent, which is what lets the same function run outside a
      // job search.
      if (trace && runId !== undefined && step !== undefined) {
        await trace.write({
          run_id: runId,
          job_id: job.id,
          step,
          event: event.event,
          collector: job.collector,
          reason: event.reason,
        });
      }
    }
  }

  return { jobs: cleanedJobs };
}

// The company half of the same sweep. A judgement about an employer ages, so
// a company scored longer ago than the score expiry has its scores emptied
// and is researched again on the next run. A category the agent guessed at,
// because nothing public existed, is emptied sooner than one it researched.
//
// Like the job half above, the two thresholds and the instant to measure
// against all arrive as arguments rather than being read from settings or the
// clock, so every company in one run is judged against the moment the run
// started.
export interface CleanBacklogCompaniesOptions {
  scoreExpiryDays: number;
  guessedScoreExpiryDays: number;
  referenceInstant: Date;
  trace?: TraceService;
  runId?: string;
  step?: string;
}

export interface CleanBacklogCompaniesResult {
  companies: CompanyRecord[];
  // How many companies lost all four scores, and how many lost only the
  // categories that were guessed. The run summary says both, and counting
  // here is what saves it reading the rows back twice.
  scoresCleared: number;
  guessesCleared: number;
}

// The outcome of looking at one company: nothing changed, every score wiped,
// or only the categories the agent admitted to guessing at.
type CompanyCleanOutcome = "kept" | "scores_cleared" | "guesses_cleared";

// How old a judgement is, in days. `jobAgeInDays` cannot answer this, because
// a job has three dates to choose between and a company has only the one, but
// the arithmetic matches it: plain division, and a date in the future counts
// as brand new rather than as a negative age.
function companyAgeInDays(scoredAt: Date, referenceInstant: Date): number {
  const elapsedMs = referenceInstant.getTime() - scoredAt.getTime();
  return Math.max(0, elapsedMs / DAY_MS);
}

// Empties one category's score and the sentence explaining it. The switch is
// here so the compiler still sees real field names — a key built from a
// template string would be checked against nothing.
function clearCategory(company: CompanyRecord, category: ScoreCategory): CompanyRecord {
  switch (category) {
    case "employee_satisfaction":
      return {
        ...company,
        employee_satisfaction: null,
        employee_satisfaction_rationale: null,
      };
    case "customer_satisfaction":
      return {
        ...company,
        customer_satisfaction: null,
        customer_satisfaction_rationale: null,
      };
    case "work_life_balance":
      return {
        ...company,
        work_life_balance: null,
        work_life_balance_rationale: null,
      };
    case "political_alignment":
      return {
        ...company,
        political_alignment: null,
        political_alignment_rationale: null,
      };
  }
}

// Decides what one company deserves and hands back a fresh record either way.
// The caller's copy is never touched, right down to its `scores_guessed`
// array, so a list can be cleaned without the original list noticing.
function cleanBacklogCompany(
  company: CompanyRecord,
  scoreExpiryDays: number,
  guessedScoreExpiryDays: number,
  referenceInstant: Date
): { company: CompanyRecord; outcome: CompanyCleanOutcome } {
  const untouched: CompanyRecord = {
    ...company,
    scores_guessed: [...company.scores_guessed],
  };

  // A company nobody has judged yet has no age, so there is nothing to expire.
  if (company.scored_at === null) {
    return { company: untouched, outcome: "kept" };
  }

  const ageInDays = companyAgeInDays(company.scored_at, referenceInstant);

  // Full expiry is asked first on purpose: a company old enough to lose
  // everything should not walk away having lost only its guesses.
  if (isPastThreshold(ageInDays, scoreExpiryDays)) {
    let cleared: CompanyRecord = { ...untouched, scores_guessed: [], scored_at: null };
    for (const category of SCORE_CATEGORIES) {
      cleared = clearCategory(cleared, category);
    }
    return { company: cleared, outcome: "scores_cleared" };
  }

  // A guess is worth less than research, so it goes stale sooner. Only the
  // guessed categories are emptied, and `scored_at` stays as it is, because
  // the categories that were actually researched really are that old.
  if (company.scores_guessed.length > 0 && isPastThreshold(ageInDays, guessedScoreExpiryDays)) {
    let cleared: CompanyRecord = untouched;
    for (const category of company.scores_guessed) {
      cleared = clearCategory(cleared, category);
    }
    return {
      company: { ...cleared, scores_guessed: [] },
      outcome: "guesses_cleared",
    };
  }

  return { company: untouched, outcome: "kept" };
}

// The handler wrapper around cleanBacklogCompany: calls it once per company
// and writes its rows through the trace service. Like its sibling it raises no
// warnings — a judgement ageing out is the handler doing its job, and the
// counts it returns are there so the run can say how much work it made.
export async function cleanBacklogCompanies(
  companies: CompanyRecord[],
  options: CleanBacklogCompaniesOptions
): Promise<CleanBacklogCompaniesResult> {
  const { scoreExpiryDays, guessedScoreExpiryDays, referenceInstant, trace, runId, step } =
    options;
  const cleanedCompanies: CompanyRecord[] = [];
  let scoresCleared = 0;
  let guessesCleared = 0;

  for (const company of companies) {
    const { company: cleanedCompany, outcome } = cleanBacklogCompany(
      company,
      scoreExpiryDays,
      guessedScoreExpiryDays,
      referenceInstant
    );
    cleanedCompanies.push(cleanedCompany);

    if (outcome === "scores_cleared") {
      scoresCleared += 1;
    } else if (outcome === "guesses_cleared") {
      guessesCleared += 1;
    }

    if (trace && runId !== undefined && step !== undefined) {
      // Every company leaves a pair of rows: one saying it was looked at, one
      // saying what came of it, so the trace reads as a list of decisions.
      await trace.write({
        run_id: runId,
        company_id: company.id,
        step,
        event: "company_entered",
      });

      if (outcome === "scores_cleared") {
        await trace.write({
          run_id: runId,
          company_id: company.id,
          step,
          event: "company_scores_cleared",
          reason: "past_expiration_threshold",
        });
      } else if (outcome === "guesses_cleared") {
        await trace.write({
          run_id: runId,
          company_id: company.id,
          step,
          event: "placeholder_company_scores_cleared",
          reason: "past_expiration_threshold",
        });
      } else {
        await trace.write({
          run_id: runId,
          company_id: company.id,
          step,
          event: "company_kept",
        });
      }
    }
  }

  return { companies: cleanedCompanies, scoresCleared, guessesCleared };
}
