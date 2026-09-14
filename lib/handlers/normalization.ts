// Turns each raw_* field a collector wrote into the tidied shape the rest of
// the app reads, by routing it through the normalizer that already owns that
// field. It is the only place the five are called together, so a caller
// reaches for one function rather than remembering all five.
//
// Every present field is recomputed from its raw source on every call, with
// no check for whether its target is already filled in. That is what makes a
// second pass over unchanged raw data end on exactly the same job, and what
// lets a pass after parsing improve on a figure the first pass got wrong or
// left out. A raw field with nothing in it is the one exception: it is left
// alone, because going looking for a missing value is parsing, a later phase
// this file has no part in.
//
// Alongside the tidied job, a call returns one trace event per field that had
// a raw value to work from, recording whether that field came out fully
// normalized, partly normalized, or not normalized at all. A field the job
// carried nothing for writes no event, matching the guardrail that left it alone.
// The events carry no run id, job id or step: a caller adds those, which is
// what lets the same function serve the pass after collection and the pass
// after parsing.

import type { JobListEntry, RawSalary } from "../types/job-list-entry";
import { normalizeTitle, type TitleVocabularies } from "../utils/title";
import { normalizeSalary } from "../utils/salary";
import { normalizeModeList } from "../utils/work-mode-list";
import { splitLocation } from "../utils/split-location";
import type { WorkMode } from "../utils/work-mode";
import { truncateDetail } from "../utils/trace-detail";
import { normalizeCompanyName } from "../utils/company-name";
import { summarizeNormalizationWarnings, type UnusableField } from "../utils/normalization-warnings";
import type { CollectionIssue } from "../types/collection-issue";
import type { TraceService } from "../services/trace-service";

export interface NormalizationEvent {
  event: "job_updated" | "normalization_failed";
  reason: string;
  detail: { from: string; to: string };
}

export function normalizeJob(
  job: JobListEntry,
  vocabularies: TitleVocabularies
): { job: JobListEntry; events: NormalizationEvent[] } {
  // A shallow copy: the five routes below only ever reassign a target field
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
    const detail = { from: truncateDetail(job.raw_title), to: truncateDetail(normalized.title) };
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
    const detail = { from: truncateDetail(JSON.stringify(raw)), to: truncateDetail(to) };

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

  // Cutting a location into places is one job and judging those places against
  // a map is another; this route only cuts. A work mode named inside a
  // location is carried down to the mode route below rather than judged here.
  const liftedModes: WorkMode[] = [];

  // A missing, null or empty list has no locations in it to cut.
  if (job.raw_location_list && job.raw_location_list.length > 0) {
    const places: string[] = [];
    const seen = new Set<string>();

    for (const raw of job.raw_location_list) {
      const split = splitLocation(raw);
      for (const place of split.places) {
        // Two locations can name one place with different casing, and the
        // pooled list holds it once, spelled the way it was first seen.
        const key = place.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        places.push(place);
      }
      liftedModes.push(...split.modes);
    }

    // Rebuilt, never appended to: normalization runs again after parsing, and
    // a second pass over unchanged raw locations has to land on the same list.
    result.normalized_location_list = places;

    // Locations have a failure row and no success row: the trace vocabulary
    // for this phase names only the failure.
    if (places.length === 0) {
      events.push({
        event: "normalization_failed",
        reason: "location_unusable",
        detail: {
          from: truncateDetail(JSON.stringify(job.raw_location_list)),
          to: truncateDetail(JSON.stringify(places)),
        },
      });
    }
  }

  const rawModeList = job.raw_mode_list ?? [];

  // A mode lifted out of a location is a mode the job has, so it lands even
  // when the source published no mode words of its own. With neither to work
  // from there is nothing to translate, and a list an earlier pass wrote stays.
  if (rawModeList.length > 0 || liftedModes.length > 0) {
    result.normalized_mode_list = normalizeModeList([...rawModeList, ...liftedModes]);
  }

  // The rows below weigh only what the source published as modes. A mode
  // lifted out of a location was never one of these words, and counting it
  // would make an unusable raw list read as partly usable.
  if (rawModeList.length > 0) {
    const normalized = normalizeModeList(rawModeList);

    // Counted against recognised raw entries, not output length: two raw
    // spellings of the same mode merge into one output entry, and that
    // still counts as both having been recognised rather than one going
    // missing. Recognition is asked of normalizeModeList itself rather than a
    // second copy of its word list.
    const recognizedCount = rawModeList.filter(
      (word) => normalizeModeList([word]).length > 0
    ).length;

    const detail = {
      from: truncateDetail(JSON.stringify(rawModeList)),
      to: truncateDetail(JSON.stringify(normalized)),
    };

    if (recognizedCount === 0) {
      events.push({ event: "normalization_failed", reason: "work_mode_unusable", detail });
    } else if (recognizedCount === rawModeList.length) {
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
      detail: { from: truncateDetail(job.raw_company_name), to: truncateDetail(normalized) },
    });
  }

  return { job: result, events };
}

export interface NormalizeJobsOptions {
  vocabularies: TitleVocabularies;
  trace?: TraceService;
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
