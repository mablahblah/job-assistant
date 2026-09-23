// A company is promoted once its four category scores show it is worth
// polling directly. Promotion itself changes nothing about the company —
// it changes the board rows the ATS slug service holds for it, filling in
// the collector that should watch that board from now on. Once a row
// carries a collector, that collector polls it on every future run, so the
// company's postings arrive first-hand instead of by way of an aggregator.

import { SCORE_CATEGORIES, type CompanyRecord } from "../services/company-service";
import type { AtsSlugService } from "../services/ats-slug-service";
import type { TraceEvent, TraceService } from "../services/trace-service";
import type { CollectionIssue } from "../types/collection-issue";
import { messageFromThrown } from "../utils/thrown-message";

export interface PromoteCompaniesOptions {
  promotionThreshold: number;
  atsSlugs: AtsSlugService;
  trace?: TraceService;
  runId?: string;
  step?: string;
}

export interface PromoteCompaniesResult {
  companies: CompanyRecord[];
  warnings: CollectionIssue[];
}

// One place mapping a board's parser to the collector that can poll it. A
// new pollable source joins by adding one line here. A parser missing from
// this list is one we can read a posting from but cannot poll, which is why
// a Dribbble company is never promoted.
const POLLABLE_COLLECTORS_BY_PARSER: Record<string, string> = {
  greenhouse: "greenhouse",
  lever: "lever",
  ashby: "ashby",
  workday: "workday",
  ultipro: "ultipro",
};

// Closed sets rather than plain strings, so a word this handler has no
// right to write fails to compile.
type PromotionSkipReason =
  | "not_fully_scored"
  | "below_promotion_threshold"
  | "no_pollable_board"
  | "already_polled";

interface PromotionOutcome {
  event: "company_promoted" | "company_promotion_skipped";
  reason?: PromotionSkipReason;
}

// The average of the four category scores, or null when any of them is
// still unscored — built from SCORE_CATEGORIES so a fifth category joins
// this average by joining that list, not by editing this function.
function averageScore(company: CompanyRecord): number | null {
  const scores = SCORE_CATEGORIES.map((category) => company[category]);
  const present = scores.filter((score): score is number => score !== null);
  if (present.length < scores.length) return null;
  return present.reduce((sum, score) => sum + score, 0) / present.length;
}

// One company's worth of the decision, separate from the loop that writes
// trace rows. This is where the service calls that change board rows live.
async function evaluateCompany(
  company: CompanyRecord,
  atsSlugs: AtsSlugService,
  promotionThreshold: number
): Promise<PromotionOutcome> {
  // A missing score leaves no average to test, so this comes before the
  // threshold check rather than treating a null as a zero.
  const average = averageScore(company);
  if (average === null) {
    return { event: "company_promotion_skipped", reason: "not_fully_scored" };
  }

  // The threshold is a bar to clear, so landing exactly on it does not qualify.
  if (average <= promotionThreshold) {
    return { event: "company_promotion_skipped", reason: "below_promotion_threshold" };
  }

  const boardRows = await atsSlugs.listForCompany(company.id);
  const pollableRows = boardRows.filter((row) => row.parser in POLLABLE_COLLECTORS_BY_PARSER);
  if (pollableRows.length === 0) {
    return { event: "company_promotion_skipped", reason: "no_pollable_board" };
  }

  const unpolledRows = pollableRows.filter((row) => row.collector === null);
  if (unpolledRows.length === 0) {
    return { event: "company_promotion_skipped", reason: "already_polled" };
  }

  for (const row of unpolledRows) {
    await atsSlugs.addCollector(row.slug, POLLABLE_COLLECTORS_BY_PARSER[row.parser]);
  }
  return { event: "company_promoted" };
}

export async function promoteCompanies(
  companies: CompanyRecord[],
  options: PromoteCompaniesOptions
): Promise<PromoteCompaniesResult> {
  const { promotionThreshold, atsSlugs, trace, runId, step } = options;
  const warnings: CollectionIssue[] = [];

  for (const company of companies) {
    // All three of trace, runId and step are needed before a row is
    // written. A step handed only some of them still does its work and
    // stays silent, which is what lets the same function run outside a
    // job search.
    const recording = trace && runId !== undefined && step !== undefined;

    // Written before the work rather than after it, so a heading in the run
    // summary can say what the step was handed even where a board lookup
    // below throws and the step never finishes.
    if (recording) {
      await trace.write({ run_id: runId, company_id: company.id, step, event: "company_entered" });
    }

    let outcome: Awaited<ReturnType<typeof evaluateCompany>>;

    try {
      outcome = await evaluateCompany(company, atsSlugs, promotionThreshold);
    } catch (thrown) {
      // A board lookup that fails for its own reasons costs this company and
      // no other. Unguarded it would leave the loop, so every company still
      // queued goes unjudged over a fault that has nothing to do with it.
      // The company keeps whatever polling it already had; the next run
      // judges it again.
      warnings.push({
        // Every other warning names the collector that produced its job. A
        // company reaches this step from the score table rather than from a
        // source, so the step's own name stands in — the same word the
        // trace rows for this step are grouped under.
        collector: "company_promotion",
        message: `Could not judge ${company.name ?? company.id} for direct polling: ${messageFromThrown(thrown)}`,
      });
      continue;
    }

    if (recording) {
      // Built conditionally rather than passing `reason: outcome.reason`
      // directly, so a promoted company's row carries no reason key at all
      // instead of one holding undefined.
      const row: TraceEvent = outcome.reason
        ? {
            run_id: runId,
            company_id: company.id,
            step,
            event: outcome.event,
            reason: outcome.reason,
          }
        : { run_id: runId, company_id: company.id, step, event: outcome.event };
      await trace.write(row);
    }
  }

  return { companies, warnings };
}
