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

import type { JobListEntry } from "./job-list-entry";
import { normalizeTitle, type TitleVocabularies } from "./title";
import { normalizeSalary } from "./salary";
import { normalizeModeList } from "./work-mode-list";
import { normalizeCompanyName } from "./company-name";

export function normalizeJob(job: JobListEntry, vocabularies: TitleVocabularies): JobListEntry {
  // A shallow copy: the four routes below only ever reassign a target field
  // on this copy, so the job passed in is never touched.
  const result: JobListEntry = { ...job };

  // normalizeTitle("") answers with an empty title rather than refusing, so
  // calling it on a missing, null or empty raw_title would wipe a title an
  // earlier pass already wrote. All three read as nothing to normalize.
  if (job.raw_title) {
    result.title = normalizeTitle(job.raw_title, vocabularies).title;
  }

  // A raw_salary of null or {} both mean no envelope was sent — null because
  // that is what a Json column with nothing in it reads back as from the
  // database, {} because a source can send the key with nothing under it.
  // Calling normalizeSalary anyway and assigning its empty result to the
  // three columns below would wipe out a salary an earlier pass found.
  if (job.raw_salary && Object.keys(job.raw_salary).length > 0) {
    const salary = normalizeSalary(job.raw_salary);
    result.salary_low = salary.salary_low;
    result.salary_high = salary.salary_high;
    result.salary_period = salary.salary_period;
  }

  // A missing, null or empty list has no modes in it to translate.
  if (job.raw_mode_list && job.raw_mode_list.length > 0) {
    result.normalized_mode_list = normalizeModeList(job.raw_mode_list);
  }

  // A missing, null or empty name has nothing to tidy.
  if (job.raw_company_name) {
    result.raw_company_name = normalizeCompanyName(job.raw_company_name);
  }

  return result;
}
