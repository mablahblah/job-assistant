// The scoring orchestrator. A pipeline cannot pause while an agent thinks, so
// scoring cannot be one handler in the deterministic run the way collection or
// classification are: something outside this process has to look at each job
// and company and decide a score. That split makes scoring one orchestrator
// with two starting points. runScoringGather cleans the backlog, reads off
// what still needs a score, and leaves a trace row for each item.
// runScoringSave takes the agent's answers back, writes them through the two
// services, and records what became of every entry.

import { cleanBacklogJobs, cleanBacklogCompanies } from "../handlers/backlog-cleanup";
import { promoteCompanies } from "../handlers/company-promotion";
import { saveJobs, saveCompanies } from "../handlers/save";
import type { AtsSlugService } from "../services/ats-slug-service";
import type { CompanyRecord, CompanyService, ScoreInput } from "../services/company-service";
import type { JobService } from "../services/job-service";
import type { SettingsService } from "../services/settings-service";
import type { TraceService } from "../services/trace-service";
import type { JobListEntry } from "../types/job-list-entry";
import type { CollectionIssue } from "../types/collection-issue";
import { messageFromThrown } from "../utils/thrown-message";
import { createFailureTracker, type RunFailure } from "../utils/run-failure";
import { isJobJudged } from "../utils/job-judged";

// The same shape the job search runner reports, so it is declared once beside
// the tracker that fills it in rather than separately in each runner.
export type ScoringFailure = RunFailure;

export interface RunScoringGatherOptions {
  settings: SettingsService;
  companies: CompanyService;
  jobService: JobService;
  trace: TraceService;
  runId: string;
  referenceInstant: Date;
}

export interface RunScoringGatherResult {
  jobs: JobListEntry[];
  companies: CompanyRecord[];
  companyScoresCleared: number;
  companyGuessesCleared: number;
  warnings: CollectionIssue[];
  failure: ScoringFailure | null;
  traceFailures: number;
}

export async function runScoringGather(
  options: RunScoringGatherOptions
): Promise<RunScoringGatherResult> {
  const result: RunScoringGatherResult = {
    jobs: [],
    companies: [],
    companyScoresCleared: 0,
    companyGuessesCleared: 0,
    warnings: [],
    failure: null,
    traceFailures: 0,
  };

  // Names the spot for the result and runs it, recording a throw before
  // letting it carry on to the one catch below. The name is passed in rather
  // than tracked in a variable the next line has to remember to update. The
  // tracker is shared with the job search runner, which is what keeps the two
  // from drifting on which failure a run reports.
  const failures = createFailureTracker();
  const at = failures.at;

  try {
    const expiryThresholdDays = await at("expiry_threshold", () =>
      options.settings.getExpiryThreshold()
    );
    const scoreExpiryDays = await at("score_expiry_days", () =>
      options.settings.getScoreExpiryDays()
    );
    const guessedScoreExpiryDays = await at("guessed_score_expiry_days", () =>
      options.settings.getGuessedScoreExpiryDays()
    );
    const priorityList = await at("source_priority_list", () =>
      options.settings.getSourcePriorityList()
    );
    // The backlog save below writes every job's key afresh from its link, so without this
    // list each gather would strip an identifying value such as UltiPro's opportunityid
    // back out of the stored keys.
    const identifyingQueryValues = await at("identifying_query_values", () =>
      options.settings.getIdentifyingQueryValues()
    );

    // The job half of backlog cleanup: read the backlog, drop what has
    // expired, then save so the drop is on disk before anything reads from
    // the jobs table again.
    const backlog = await at("backlog_lookup", () => options.jobService.findBacklog());
    const cleanedBacklog = await at("backlog_cleanup", () =>
      cleanBacklogJobs(backlog, {
        expiryThresholdDays,
        referenceInstant: options.referenceInstant,
        trace: options.trace,
        runId: options.runId,
        step: "backlog_cleanup",
      })
    );
    const savedJobs = await at("post_backlog_cleanup_save", () =>
      saveJobs(cleanedBacklog.jobs, {
        jobService: options.jobService,
        priorityList,
        identifyingQueryValues,
        trace: options.trace,
        runId: options.runId,
        step: "post_backlog_cleanup_save",
      })
    );
    result.warnings.push(...savedJobs.warnings);

    // The company half of backlog cleanup: read every scored company, clear
    // whichever scores or guesses have gone stale, then save. This has to
    // land before the "who needs a score" searches below, or a company this
    // run just emptied would be missing from its own result.
    const scoredCompanies = await at("scored_company_lookup", () =>
      options.companies.findScored()
    );
    const cleanedCompanies = await at("backlog_cleanup_companies", () =>
      cleanBacklogCompanies(scoredCompanies, {
        scoreExpiryDays,
        guessedScoreExpiryDays,
        referenceInstant: options.referenceInstant,
        trace: options.trace,
        runId: options.runId,
        step: "backlog_cleanup",
      })
    );
    result.companyScoresCleared = cleanedCompanies.scoresCleared;
    result.companyGuessesCleared = cleanedCompanies.guessesCleared;
    const savedCompanies = await at("backlog_cleanup_company_save", () =>
      saveCompanies(cleanedCompanies.companies, {
        companyService: options.companies,
        trace: options.trace,
        runId: options.runId,
        step: "post_backlog_cleanup_save",
      })
    );
    result.warnings.push(...savedCompanies.warnings);

    // Only now, with both saves landed, is it safe to ask who still needs a
    // score.
    const jobsNeedingScores = await at("jobs_needing_scores_lookup", () =>
      options.jobService.findNeedingScores()
    );
    const companiesNeedingScores = await at("companies_needing_scores_lookup", () =>
      options.companies.findNeedingScores()
    );
    result.jobs = jobsNeedingScores;
    result.companies = companiesNeedingScores;

    await at("scoring", async () => {
      for (const job of jobsNeedingScores) {
        // A trace row is keyed by job id and collector, so a job carrying
        // neither has nothing to key its record on and is gathered without
        // leaving one.
        if (!job.id || !job.collector) continue;
        await options.trace.write({
          run_id: options.runId,
          job_id: job.id,
          step: "scoring",
          event: "job_entered",
          collector: job.collector,
        });
      }
      for (const company of companiesNeedingScores) {
        await options.trace.write({
          run_id: options.runId,
          company_id: company.id,
          step: "scoring",
          event: "company_entered",
        });
      }
    });
  } catch {
    // Nothing to read off the throw here: `at` named the spot and wrote the
    // reason on its way past.
  }

  result.traceFailures = options.trace.failureCount();
  result.failure = failures.failure();
  return result;
}

export type JobScoringFailure = "no_posting_url" | "posting_unreadable" | "scoring_agent_failed";
export type CompanyScoringFailure = "no_company_name" | "scoring_agent_failed";

// One job's answer from a scoring helper. A score present means the helper
// judged it; a score absent means it could not, and `failure` says why.
export interface JobScore {
  id: string;
  alignment_score?: number | null;
  alignment_rationale?: string | null;
  failure?: JobScoringFailure;
}

// One company's answer. `scores` covers only the categories the helper was
// asked about, so a company already holding three keeps them.
export interface CompanyScore {
  id: string;
  scores?: ScoreInput;
  failure?: CompanyScoringFailure;
}

export interface RunScoringSaveOptions {
  jobScores: JobScore[];
  companyScores: CompanyScore[];
  settings: SettingsService;
  companies: CompanyService;
  jobService: JobService;
  atsSlugs: AtsSlugService;
  trace: TraceService;
  runId: string;
  scoredAt: Date;
}

export interface RunScoringSaveResult {
  warnings: CollectionIssue[];
  failure: ScoringFailure | null;
  traceFailures: number;
}

// The other starting point. The agent has finished thinking by now, so this
// half only writes the answers down and records what became of each entry. It
// is called once per batch the agent produces rather than once per run, so a
// run that stops halfway still keeps the research it already paid for.
export async function runScoringSave(
  options: RunScoringSaveOptions
): Promise<RunScoringSaveResult> {
  const result: RunScoringSaveResult = {
    warnings: [],
    failure: null,
    traceFailures: 0,
  };

  // Names the spot for the result and runs it, recording a throw before
  // letting it carry on to the one catch below. A tracker of its own, because
  // the result it fills in is this call's own.
  const failures = createFailureTracker();
  const at = failures.at;

  try {
    // Declared out here so the judged pass further down can reuse the list
    // and the map rather than read them again.
    let priorityList: readonly string[] = [];
    const collectorById = new Map<string, string>();

    // There is nothing to write, and no collector to look up, without a job
    // score to save — so both reads below only happen when one is coming.
    if (options.jobScores.length > 0) {
      priorityList = await at("source_priority_list", () =>
        options.settings.getSourcePriorityList()
      );

      // A score answer carries only an id, so the job's collector is read
      // off the row that produced it rather than trusted to a round trip.
      const needingScores = await at("jobs_needing_scores_lookup", () =>
        options.jobService.findNeedingScores()
      );
      for (const job of needingScores) {
        if (job.id) collectorById.set(job.id, job.collector ?? "unknown");
      }

      await at("scoring", async () => {
        for (const jobScore of options.jobScores) {
          const collector = collectorById.get(jobScore.id) ?? "unknown";
          try {
            if (typeof jobScore.alignment_score === "number") {
              await options.jobService.update(
                {
                  id: jobScore.id,
                  alignment_score: jobScore.alignment_score,
                  alignment_rationale: jobScore.alignment_rationale ?? null,
                },
                priorityList
              );
              await options.trace.write({
                run_id: options.runId,
                job_id: jobScore.id,
                step: "scoring",
                event: "job_scored",
                collector,
              });
            } else {
              await options.trace.write({
                run_id: options.runId,
                job_id: jobScore.id,
                step: "scoring",
                event: "scoring_failed",
                reason: jobScore.failure ?? "scoring_agent_failed",
                collector,
              });
            }
          } catch (thrown) {
            // A write that fails costs only this job — the rest of the
            // batch still needs its chance to be saved.
            await options.trace.write({
              run_id: options.runId,
              job_id: jobScore.id,
              step: "scoring",
              event: "scoring_failed",
              reason: "db_write_failed",
              collector,
            });
            result.warnings.push({
              collector,
              message: `Job ${jobScore.id} scoring failed: ${messageFromThrown(thrown)}`,
            });
          }
        }
      });
    }

    // Holds every company whose score write actually landed, so promotion
    // below has something real to judge. Declared out here because the loop
    // that fills it sits inside the callback.
    const savedCompanies: CompanyRecord[] = [];

    await at("scoring", async () => {
      for (const companyScore of options.companyScores) {
        try {
          if (companyScore.scores) {
            const savedCompany = await options.companies.saveScores(
              companyScore.id,
              companyScore.scores,
              options.scoredAt
            );
            savedCompanies.push(savedCompany);
            // A guessed category means the helper found nothing public for
            // it, so the company is only partially, not fully, scored.
            const guessed = Object.values(companyScore.scores).some(
              (category) => category?.guessed === true
            );
            await options.trace.write(
              guessed
                ? {
                    run_id: options.runId,
                    company_id: companyScore.id,
                    step: "scoring",
                    event: "company_partially_scored",
                    reason: "insufficient_research",
                  }
                : {
                    run_id: options.runId,
                    company_id: companyScore.id,
                    step: "scoring",
                    event: "company_scored",
                  }
            );
          } else {
            await options.trace.write({
              run_id: options.runId,
              company_id: companyScore.id,
              step: "scoring",
              event: "company_scoring_failed",
              reason: companyScore.failure ?? "scoring_agent_failed",
            });
          }
        } catch (thrown) {
          // Same isolation as jobs: one company's failed write does not
          // stop the rest of the batch from being written.
          await options.trace.write({
            run_id: options.runId,
            company_id: companyScore.id,
            step: "scoring",
            event: "company_scoring_failed",
            reason: "db_write_failed",
          });
          result.warnings.push({
            collector: "unknown",
            message: `Company ${companyScore.id} scoring failed: ${messageFromThrown(thrown)}`,
          });
        }
      }
    });

    // Scoring is what judges a job. Each job this batch answered for is judged
    // once it holds a fit score or its employer holds any score. This runs
    // after the company half, so an employer scored in this same batch counts.
    // A job the batch holds no answer for, such as one whose page was refused,
    // is never reached. Nothing here is traced or warned about, because the
    // marker only changes how the dashboard shows a job.
    if (options.jobScores.length > 0) {
      await at("scoring", async () => {
        for (const jobScore of options.jobScores) {
          try {
            const job = await options.jobService.findById(jobScore.id);
            if (!job) continue;
            const employer = job.company_id
              ? await options.companies.findById(job.company_id)
              : null;
            if (!job.is_judged && isJobJudged(job, employer)) {
              await options.jobService.update({ id: jobScore.id, is_judged: true }, priorityList);
            }
          } catch (thrown) {
            // A marker that fails to save costs only this job. The jobs after
            // it still need marking, and the promotion below still needs to
            // run — the marker is the least of what this batch carries.
            result.warnings.push({
              collector: collectorById.get(jobScore.id) ?? "unknown",
              message: `Job ${jobScore.id} scoring failed: ${messageFromThrown(thrown)}`,
            });
          }
        }
      });
    }

    // Promotion closes the batch, so a company this batch just scored well
    // is polled directly from the next run rather than waiting for a pass of
    // its own. A batch that saved no company has nothing to judge, so it
    // does not pay for the settings read either.
    if (savedCompanies.length > 0) {
      const promotionThreshold = await at("promotion_threshold", () =>
        options.settings.getPromotionThreshold()
      );
      const promoted = await at("company_promotion", () =>
        promoteCompanies(savedCompanies, {
          promotionThreshold,
          atsSlugs: options.atsSlugs,
          trace: options.trace,
          runId: options.runId,
          step: "company_promotion",
        })
      );
      // A company whose board lookup failed is judged again next run, so the
      // only record of it having been skipped is this warning.
      result.warnings.push(...promoted.warnings);
    }
  } catch {
    // Nothing to read off the throw here: `at` named the spot and wrote the
    // reason on its way past.
  }

  result.traceFailures = options.trace.failureCount();
  result.failure = failures.failure();
  return result;
}
