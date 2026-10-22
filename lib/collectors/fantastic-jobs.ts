// Asks Fantastic.jobs, a paid service reached through an Apify actor, for new
// design jobs posted on employers' own hiring systems. Each job search runs
// two searches one after the other, remote first and then Austin, because a
// town list carried into the remote search would narrow it to those towns.
// The service's name, its actor id and its error-item shape live only here.
import type { JobListEntry } from "../types/job-list-entry";
import { messageFromThrown } from "../utils/thrown-message";
import { shortReply } from "../utils/short-reply";
import { DAY_MS } from "../utils/durations";
import { runApifyActor } from "../tools/apify";
import type { Collector, CollectorResult } from "./collector";

const COLLECTOR_NAME = "fantastic-jobs";
const TOKEN_VARIABLE = "FANTASTIC_JOBS_APIFY_TOKEN";

// The actor that lists jobs from employers' own career sites, in Apify's
// "owner~name" address form.
const ACTOR_ID = "fantastic-jobs~career-site-job-listing-api";

// What Apify is told to stop the run at, so one slow search cannot run on.
const TIME_LIMIT_SECONDS = 240;

// How long the app itself waits. Longer than Apify's own limit so it is only
// a safety net, and Apify's stop is the one that normally ends a run.
const WAIT_SECONDS = 270;

// The most Apify may charge for one search, so a runaway search cannot spend
// more than this.
const CHARGE_CAP_USD = 2.5;

// The most jobs one search asks for. Carried in the service's own `limit`
// field because Apify's item cap did not hold in the paid test.
const MAX_JOBS = 200;

// The fewest jobs the service accepts in `limit`; it refuses anything lower.
const MIN_JOBS = 10;

// How far before a search's last success the next one starts. Covers date-only
// stamps, which appeared up to 22.6 hours after their stamp in the paid test.
const LOOK_BACK_HOURS = 24;

// The country the remote search covers; remote jobs are filtered by work
// arrangement rather than by town.
const REMOTE_COUNTRY = "United States";

// Staffing agencies are left out; they repost other employers' jobs.
const REMOVE_AGENCY = true;

// Plain text rather than HTML, so the description needs no cleaning.
const DESCRIPTION_TYPE = "text";

// The suffix that makes a title match as a prefix in the service's search.
const PREFIX_SUFFIX = ":*";

const HOUR_MS = 60 * 60 * 1000;

// The service reads a date-time with no time zone as UTC, so a start date is
// sent as a UTC reading cut to this length, with no fraction or zone letter.
const SERVICE_TIME_LENGTH = "2026-01-01T00:00:00".length;

// The window setting is in days; the service takes its own codes.
const WINDOW_CODES: Record<number, string> = { 1: "24h", 7: "7d" };

interface Search {
  key: string;
  label: string;
}

const REMOTE_SEARCH: Search = { key: "remote", label: "remote search" };
const AUSTIN_SEARCH: Search = { key: "austin", label: "Austin search" };

type Item = Record<string, unknown>;

// A text field as the service sent it, or empty when it sent something else, so
// collection drops the job as unusable and says why.
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

// The service's times carry no zone but are UTC, and new Date() would read a
// zone-less date-time as local time. A missing zone gets "Z" added first.
function readUtc(value: unknown): Date | undefined {
  if (typeof value !== "string") return undefined;
  const hasTime = value.includes("T");
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const date = new Date(hasTime && !hasZone ? `${value}Z` : value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function toJobListEntry(item: Item): JobListEntry {
  const url = text(item["url"]);
  const remoteAreas = stringList(item["ai_remote_location"]);
  // The service's own field says whether a job is remote: on-site and hybrid
  // jobs carry null there, so the label is not interpreted.
  const places = [
    ...stringList(item["locations_derived"]),
    ...(remoteAreas.length > 0 ? [...remoteAreas, ...stringList(item["countries_derived"])] : []),
  ];
  const arrangement = item["ai_work_arrangement"];
  const entry: JobListEntry = {
    original_url: url,
    // Already the employer's own posting, so it needs no resolving; parsing still runs.
    resolved_url: url,
    raw_title: text(item["title"]),
    raw_company_name: text(item["organization"]),
    raw_location_list: [...new Set(places)],
    raw_mode_list: typeof arrangement === "string" && arrangement !== "" ? [arrangement] : [],
    description: text(item["description_text"]) || undefined,
    is_resolved: true,
    is_parsed: false,
    is_classified: false,
  };
  const posted = readUtc(item["date_posted"]);
  if (posted) entry.posting_date = posted;
  const created = readUtc(item["date_created"]);
  if (created) entry.posting_updated_date = created;
  return entry;
}

// The service reports a refused search as a finished run holding one error item.
function lonelyErrorText(items: unknown[]): string | undefined {
  if (items.length !== 1) return undefined;
  const only = items[0];
  if (typeof only !== "object" || only === null) return undefined;
  const text = (only as Item)["error"];
  return typeof text === "string" ? shortReply(text) : undefined;
}

export const fantasticJobsCollector: Collector = {
  name: COLLECTOR_NAME,
  async collect({ settings, atsSlugs, limit, collectedAt, lastSuccesses }): Promise<CollectorResult> {
    const token = process.env[TOKEN_VARIABLE];
    if (token === undefined || token === "") {
      return { jobs: [], errors: [`Fantastic.jobs needs ${TOKEN_VARIABLE} in the environment.`], warnings: [] };
    }

    const windowDays = await settings.getSearchWindowDays();
    const timeRange = WINDOW_CODES[windowDays];
    if (timeRange === undefined) {
      return {
        jobs: [],
        errors: [`The Fantastic.jobs window setting holds ${windowDays}; it must be ${Object.keys(WINDOW_CODES).join(" or ")}.`],
        warnings: [],
      };
    }

    const searchTerms = await settings.getSearchTerms();
    const excludedTitles = await settings.getExcludedTitles();
    const towns = await settings.getSearchTowns();
    const remoteLabels = await settings.getRemoteLabels();
    const ageLimitDays = await settings.getExpiryThreshold();
    const polled = await atsSlugs.listPolled();

    if (towns.length === 0 && remoteLabels.length === 0) {
      return {
        jobs: [],
        errors: ["Fantastic.jobs ran no search: the town list and the remote-label list are both empty."],
        warnings: [],
      };
    }

    // Jobs from boards the pipeline already polls are left out of the purchase.
    const polledCompanies = [
      ...new Set(polled.map((row) => row.company_name).filter((name): name is string => name !== null)),
    ];
    const lookBackDays = Math.min(ageLimitDays, windowDays);
    const jobLimit = Number.isFinite(limit) ? Math.min(MAX_JOBS, Math.max(MIN_JOBS, limit)) : MAX_JOBS;

    const sends: Array<{ search: Search; extra: Record<string, unknown> }> = [];
    if (remoteLabels.length > 0) {
      sends.push({
        search: REMOTE_SEARCH,
        extra: { locationSearch: [REMOTE_COUNTRY], aiWorkArrangementFilter: remoteLabels },
      });
    }
    if (towns.length > 0) {
      sends.push({ search: AUSTIN_SEARCH, extra: { locationSearch: towns } });
    }

    const jobs: JobListEntry[] = [];
    const worked: string[] = [];
    const failures: string[] = [];
    const warnings: string[] = [];

    for (const { search, extra } of sends) {
      const lastSuccess = await lastSuccesses.find(COLLECTOR_NAME, search.key);
      // Never look back past the age limit or the window, however old the saved time.
      let start = collectedAt.getTime() - lookBackDays * DAY_MS;
      if (lastSuccess) start = Math.max(start, lastSuccess.getTime() - LOOK_BACK_HOURS * HOUR_MS);

      const input: Record<string, unknown> = {
        titleSearch: searchTerms.filter((term) => term.trim() !== "").map((term) => `${term.trim()}${PREFIX_SUFFIX}`),
        titleExclusionSearch: excludedTitles.map((title) => `${title}${PREFIX_SUFFIX}`),
        organizationExclusionSearch: polledCompanies,
        ...extra,
        removeAgency: REMOVE_AGENCY,
        descriptionType: DESCRIPTION_TYPE,
        timeRange,
        datePostedAfter: new Date(start).toISOString().slice(0, SERVICE_TIME_LENGTH),
        limit: jobLimit,
      };

      let reason: string | undefined;
      let items: unknown[] = [];
      try {
        items = await runApifyActor({
          actor: ACTOR_ID,
          input,
          token,
          timeLimitSeconds: TIME_LIMIT_SECONDS,
          chargeCapUsd: CHARGE_CAP_USD,
          waitSeconds: WAIT_SECONDS,
        });
        reason = lonelyErrorText(items);
      } catch (err) {
        reason = messageFromThrown(err);
      }

      if (reason !== undefined) {
        // The message adds its own full stop, so one the reply ends with is dropped.
        const said = reason.replace(/\.+$/, "");
        failures.push(
          lastSuccess
            ? `Fantastic.jobs ${search.label} failed: ${said}. Its saved time was kept, so the next job search asks again for what it missed.`
            : `Fantastic.jobs ${search.label} failed: ${said}. It has never worked, so the next job search looks back ${lookBackDays} days.`
        );
        continue;
      }

      worked.push(search.key);
      if (items.length >= MAX_JOBS) {
        warnings.push(
          `Fantastic.jobs ${search.label} returned ${items.length} jobs, its cap, so more may have matched.`
        );
      }
      for (const item of items) jobs.push(toJobListEntry(item as Item));
    }

    // A failure is only a warning while another search still worked.
    const errors = worked.length > 0 ? [] : failures;
    if (worked.length > 0) warnings.push(...failures);

    const result: CollectorResult = {
      jobs: Number.isFinite(limit) ? jobs.slice(0, limit) : jobs,
      errors,
      warnings,
    };
    // With a job limit the run is partial, so no saved time may move.
    if (!Number.isFinite(limit)) result.workedSearches = worked;
    return result;
  },
};
