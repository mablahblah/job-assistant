// The job title a work log entry copies onto itself. It is copied rather than
// read through to the job, because the entry is a legal filing that outlives
// the job row.
//
// The tidied title comes first, because it is what every other part of the
// app shows: an entry naming the published title instead would read as a
// different job from the same job on a page beside it. Tidying fails on some
// titles and a job can reach this point unparsed, so the published title
// stands in.
//
// Where neither exists the answer is nothing and the caller writes no entry.
// A filing naming a blank job is worse than no filing.

export function entryTitleFromJob(job: {
  title?: string | null;
  raw_title?: string | null;
}): string | undefined {
  const tidied = job.title?.trim();
  if (tidied) return tidied;

  const published = job.raw_title?.trim();
  if (published) return published;

  return undefined;
}
