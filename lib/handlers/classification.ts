// The judging step. It is handed every backlog job that is resolved, parsed
// and not yet judged, and answers three questions about each one: is this the
// same posting listed again, is it too old to bother with, and is it somewhere
// the user could work.
//
// The order matters. The repost mark is a fact about the posting rather than a
// verdict on it, so it is decided first and survives whatever the other two
// checks decide — a job can be both a repost and too old. The age check comes
// before the location match because a job the user cannot apply to is not worth
// spending a paced, paid mapping request on.
//
// The step reads no clock. The reference instant arrives as an argument, so a
// run lasting half an hour judges every job against the moment it started.
//
// A job whose places could not be read is left in the backlog rather than
// judged, because a place we could not read is not proof the job is far away.
// Guarding each job on its own is what makes that survivable: one refused
// lookup costs that job rather than the rest of the list.

import type { JobListEntry } from "../types/job-list-entry";
import type { PlaceService } from "../services/place-service";
import type { TraceService } from "../services/trace-service";
import type { Geocoder } from "../tools/geocoder";
import { isPastThreshold, jobAgeInDays } from "../utils/job-age";
import { matchLocation, type MatchablePlace } from "../utils/location-match";

const MILLISECONDS_PER_DAY = 86400000;

export interface ClassifyJobsOptions {
  repostGapDays: number;
  expiryThresholdDays: number;
  referenceInstant: Date;
  home: { latitude: number; longitude: number };
  radiusMiles: number;
  places: PlaceService;
  geocoder: Geocoder;
  trace?: TraceService;
  runId?: string;
  step?: string;
}

export interface ClassifyJobsResult {
  jobs: JobListEntry[];
}

// The entering row, the repost row where there is one, and the outcome row, in
// the order they are written, so a job's fate always reads off its latest row.
// Typed as a closed set rather than plain strings, so a word this step has no
// right to write fails to compile.
interface ClassificationEvent {
  event: "job_entered" | "job_reposted" | "job_expired" | "job_classified" | "classification_failed";
  reason?: "past_expiry_threshold" | "no_location_match" | "location_unreadable";
}

interface ClassifiedJob {
  job: JobListEntry;
  events: ClassificationEvent[];
}

// Two posting dates far enough apart mean the role was listed again rather than
// edited. The gap is an exact duration rather than a count of calendar days,
// because absorbing two collectors that disagree by hours about one posting is
// the whole point of the setting. One date alone says nothing either way.
function isRepost(job: JobListEntry, repostGapDays: number): boolean {
  const { posting_date: posted, posting_updated_date: updated } = job;
  if (!posted || !updated) return false;

  const gapInDays = Math.abs(updated.getTime() - posted.getTime()) / MILLISECONDS_PER_DAY;
  return gapInDays > repostGapDays;
}

// A place already held is never asked of the mapping service, and a text that
// already came back empty this run is never asked twice. The dead-end set is
// checked first because nothing is ever stored for an empty answer, so a text
// in it cannot be in the table either — asking would be a wasted read.
//
// The service stores nothing for an empty answer, which is what leaves the text
// free to be tried again on a later run, once a better splitter or a better map
// might place it.
async function resolvePlace(
  text: string,
  places: PlaceService,
  geocoder: Geocoder,
  unreadableTexts: Set<string>
): Promise<MatchablePlace | null> {
  if (unreadableTexts.has(text)) return null;

  const held = await places.findByText(text);
  if (held) return held;

  const found = await geocoder.lookUp(text);
  await places.store(text, found);

  if (!found) {
    unreadableTexts.add(text);
    return null;
  }

  // The mapping service answers without the text it was asked, so that text is
  // carried back in to name which place matched.
  return {
    lookup_text: text,
    latitude: found.latitude,
    longitude: found.longitude,
    outline: found.outline,
  };
}

async function classifyJob(
  job: JobListEntry,
  options: ClassifyJobsOptions,
  unreadableTexts: Set<string>
): Promise<ClassifiedJob> {
  const { repostGapDays, expiryThresholdDays, referenceInstant, home, radiusMiles } = options;
  const { places, geocoder } = options;

  const events: ClassificationEvent[] = [{ event: "job_entered" }];

  // The job handed in is never touched; every answer lands on this copy.
  const judgedJob: JobListEntry = { ...job, is_repost: isRepost(job, repostGapDays) };

  // Written before the outcome row, so the outcome stays the job's last word.
  if (judgedJob.is_repost) events.push({ event: "job_reposted" });

  const ageInDays = jobAgeInDays(
    {
      posting_date: job.posting_date,
      posting_updated_date: job.posting_updated_date,
      // collected_at is a required column, so a job read off the backlog always
      // carries one. The fallback satisfies the partial type rather than a real
      // case, and reads an undated job as just seen, so missing data is never
      // on its own the thing that expires a job.
      collected_at: job.collected_at ?? referenceInstant,
    },
    referenceInstant
  );

  if (isPastThreshold(ageInDays, expiryThresholdDays)) {
    events.push({ event: "job_expired", reason: "past_expiry_threshold" });
    return { job: { ...judgedJob, status: "expired", is_classified: true }, events };
  }

  const locationTexts = job.normalized_location_list ?? [];

  try {
    const resolvedPlaces: MatchablePlace[] = [];
    for (const text of locationTexts) {
      const place = await resolvePlace(text, places, geocoder, unreadableTexts);
      if (place) resolvedPlaces.push(place);
    }

    // A job that named places and had none of them read stays in the backlog
    // untouched and unjudged. Unreadable is a different answer from far away.
    if (locationTexts.length > 0 && resolvedPlaces.length === 0) {
      events.push({ event: "classification_failed", reason: "location_unreadable" });
      return { job: judgedJob, events };
    }

    // A job naming no place at all comes through here too, and is judged on its
    // work mode alone — a posting saying only "remote" names nowhere and is
    // still work the user could do.
    const match = matchLocation({
      places: resolvedPlaces,
      modes: job.normalized_mode_list ?? [],
      home,
      radiusMiles,
    });

    if (match.matched) {
      events.push({ event: "job_classified" });
      return {
        job: {
          ...judgedJob,
          location_match: true,
          location_match_place: match.place,
          location_match_mode: match.mode,
          is_classified: true,
        },
        events,
      };
    }

    events.push({ event: "classification_failed", reason: "no_location_match" });
    return {
      job: { ...judgedJob, status: "too far", location_match: false, is_classified: true },
      events,
    };
  } catch {
    // From the job's point of view a refused lookup is the same as a place that
    // could not be read, and reusing that reason keeps every job to exactly one
    // outcome row. The job is left as the repost check left it, so a later run
    // picks it back up.
    events.push({ event: "classification_failed", reason: "location_unreadable" });
    return { job: judgedJob, events };
  }
}

// The step wrapper around classifyJob: calls it once per entry and writes its
// rows through the trace service. It raises no warnings — a job being too far
// away or too old is the step working rather than a problem with it.
export async function classifyJobs(
  jobs: JobListEntry[],
  options: ClassifyJobsOptions
): Promise<ClassifyJobsResult> {
  const { trace, runId, step } = options;
  const classifiedJobs: JobListEntry[] = [];

  // The memory of texts that resolved to nothing lives in the call rather than
  // the module, so one run cannot inherit another's dead ends and skip a
  // mapping service that has since learned the place.
  const unreadableTexts = new Set<string>();

  for (const job of jobs) {
    const { job: classifiedJob, events } = await classifyJob(job, options, unreadableTexts);
    classifiedJobs.push(classifiedJob);

    // A trace row is keyed by job id and collector, so a job carrying neither
    // has nothing to key its record on and is judged without leaving a record.
    if (!job.id || !job.collector) continue;

    for (const event of events) {
      // All three of trace, runId and step are needed before a row is written.
      // A step handed only some of them still does its work and stays silent,
      // which is what lets the same function run outside a job search.
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

  return { jobs: classifiedJobs };
}
