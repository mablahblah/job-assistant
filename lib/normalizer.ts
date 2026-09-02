// Turns each raw_* field a collector wrote into the tidied shape the rest of
// the app reads, by routing it through the normalizer that already owns that
// field. It is the only place the four are called together, so a caller
// reaches for one function rather than remembering all four.
//
// Every present field is recomputed from its raw source on every call, with
// no check for whether its target is already filled in. That is what makes a
// second pass over unchanged raw data land on exactly the same job, and what
// lets a pass after parsing improve on a figure the first pass got wrong or
// left out. A raw field with nothing in it is the one exception: it is left
// alone, because going looking for a missing value is parsing, a later phase
// this file has no part in.
//
// Alongside the tidied job, a call returns one trace event per field that had
// a raw value to work from, recording whether that field came out fully
// normalized, partly normalized, or not normalized at all. A field the job
// carried nothing for writes no event, matching the guard that left it alone.
// The events carry no run id, job id or step: a caller adds those, which is
// what lets the same function serve the pass after collection and the pass
// after parsing.

import type { JobListEntry, RawSalary } from "./job-list-entry";
import { normalizeTitle, type TitleVocabularies } from "./title";
import { normalizeSalary } from "./salary";
import { normalizeModeList } from "./work-mode-list";
import { normalizeCompanyName } from "./company-name";
import { summarizeNormalizationWarnings, type UnusableField } from "./normalization-warnings";
import type { CollectionIssue } from "./search-orchestrator";
import type { TraceWriter } from "./trace-writer";

export interface NormalizationEvent {
  event: "job_updated" | "normalization_failed";
  reason: string;
  detail: { from: string; to: string };
}

// The longest real job title measured is 131 characters and the longest real
// company name is 50, so 200 fits every genuine value while still cutting a
// description a collector bug put in the wrong field.
const MAX_DETAIL_LENGTH = 200;

function truncate(value: string): string {
  return value.length > MAX_DETAIL_LENGTH ? value.slice(0, MAX_DETAIL_LENGTH) : value;
}

export function normalizeJob(
  job: JobListEntry,
  vocabularies: TitleVocabularies
): { job: JobListEntry; events: NormalizationEvent[] } {
  // A shallow copy: the four routes below only ever reassign a target field
  // on this copy, so the job passed in is never touched.
  const result: JobListEntry = { ...job };
  const events: NormalizationEvent[] = [];

  // normalizeTitle("") answers with an empty title rather than refusing, so
  // calling it on a missing, null or empty raw_title would wipe a title an
  // earlier pass already wrote. All three read as nothing to normalize.
  if (job.raw_title) {
    const normalized = normalizeTitle(job.raw_title, vocabularies);
    result.title = normalized.title;

    // One input, one outcome: normalizeTitle either found a job noun to build
    // a title around or it did not, so there is no partial case here.
    const detail = { from: truncate(job.raw_title), to: truncate(normalized.title) };
    events.push(
      normalized.matched
        ? { event: "job_updated", reason: "title_normalized", detail }
        : { event: "normalization_failed", reason: "title_not_normalized", detail }
    );
  }

  // A raw_salary of null or {} both mean no envelope was sent — null because
  // that is what a Json column with nothing in it reads back as from the
  // database, {} because a source can send the key with nothing under it.
  // Calling normalizeSalary anyway and assigning its empty result to the
  // three columns below would wipe out a salary an earlier pass found.
  if (job.raw_salary && Object.keys(job.raw_salary).length > 0) {
    const raw: RawSalary = job.raw_salary;
    const salary = normalizeSalary(raw);
    result.salary_low = salary.salary_low;
    result.salary_high = salary.salary_high;
    result.salary_period = salary.salary_period;

    // Only the three envelope keys with a column to land in count as present.
    // salary_currency and salary_unit are read by normalizeSalary but have
    // nowhere to be stored, so counting them would file every salary carrying
    // a currency as partly done even when its figures came through whole.
    const countable = [
      { present: raw.salary_min !== undefined, normalized: salary.salary_low !== undefined },
      { present: raw.salary_max !== undefined, normalized: salary.salary_high !== undefined },
      { present: raw.salary_period !== undefined, normalized: salary.salary_period !== undefined },
    ].filter((field) => field.present);
    const normalizedCount = countable.filter((field) => field.normalized).length;

    const to = JSON.stringify({
      salary_low: salary.salary_low,
      salary_high: salary.salary_high,
      salary_period: salary.salary_period,
    });
    const detail = { from: truncate(JSON.stringify(raw)), to: truncate(to) };

    // Nothing normalized is checked first, so an envelope holding only a
    // currency — nothing countable at all — reads as unusable rather than
    // slipping through as fully normalized on a count of zero out of zero.
    if (normalizedCount === 0) {
      events.push({ event: "normalization_failed", reason: "salary_unusable", detail });
    } else if (normalizedCount === countable.length) {
      events.push({ event: "job_updated", reason: "salary_normalized", detail });
    } else {
      events.push({ event: "job_updated", reason: "salary_partially_normalized", detail });
    }
  }

  // A missing, null or empty list has no modes in it to translate.
  if (job.raw_mode_list && job.raw_mode_list.length > 0) {
    const normalized = normalizeModeList(job.raw_mode_list);
    result.normalized_mode_list = normalized;

    // Counted against recognised raw entries, not output length: two raw
    // spellings of the same mode collapse into one output entry, and that
    // still counts as both having been recognised rather than one going
    // missing. Recognition is asked of normalizeModeList itself rather than a
    // second copy of its word list.
    const recognizedCount = job.raw_mode_list.filter(
      (word) => normalizeModeList([word]).length > 0
    ).length;

    const detail = {
      from: truncate(JSON.stringify(job.raw_mode_list)),
      to: truncate(JSON.stringify(normalized)),
    };

    if (recognizedCount === 0) {
      events.push({ event: "normalization_failed", reason: "work_mode_unusable", detail });
    } else if (recognizedCount === job.raw_mode_list.length) {
      events.push({ event: "job_updated", reason: "work_mode_normalized", detail });
    } else {
      events.push({ event: "job_updated", reason: "work_mode_partially_normalized", detail });
    }
  }

  // A missing, null or empty name has nothing to tidy.
  if (job.raw_company_name) {
    const normalized = normalizeCompanyName(job.raw_company_name);
    result.raw_company_name = normalized;

    // A tidy has no way to fail: it only trims and drops trailing junk.
    events.push({
      event: "job_updated",
      reason: "company_name_normalized",
      detail: { from: truncate(job.raw_company_name), to: truncate(normalized) },
    });
  }

  return { job: result, events };
}

export interface NormalizeJobsOptions {
  vocabularies: TitleVocabularies;
  trace?: TraceWriter;
  runId?: string;
  step?: string;
}

export interface NormalizeJobsResult {
  jobs: JobListEntry[];
  warnings: CollectionIssue[];
}

// The step wrapper around normalizeJob: calls it once per entry in the list,
// writes one trace row per normalization event through the trace service,
// and folds every unusable field into the warnings its caller passes up to
// the user. Tracing and warnings both run off the same events, but a job
// missing the id or collector they are keyed by contributes to neither.
export async function normalizeJobs(
  jobs: JobListEntry[],
  options: NormalizeJobsOptions
): Promise<NormalizeJobsResult> {
  const { vocabularies, trace, runId, step } = options;
  const normalizedJobs: JobListEntry[] = [];
  const unusable: UnusableField[] = [];

  for (const job of jobs) {
    const { job: normalizedJob, events } = normalizeJob(job, vocabularies);
    normalizedJobs.push(normalizedJob);

    // A trace row and a warning line are both keyed by job id and collector,
    // so a job carrying neither has nothing to key its record on and is
    // normalized without leaving any record of the fields it could not
    // normalize.
    if (!job.id || !job.collector) continue;

    for (const event of events) {
      unusable.push({ collector: job.collector, reason: event.reason, example: event.detail.from });

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
          detail: event.detail,
        });
      }
    }
  }

  return { jobs: normalizedJobs, warnings: summarizeNormalizationWarnings(unusable) };
}
