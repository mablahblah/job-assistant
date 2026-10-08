// Adds jobs the user found outside a job search, from their links, and runs
// only those jobs through the same handlers a job search uses. It collects
// from no job source. The job search reads the whole table for jobs waiting at
// each step. This runner reads back only the ids it has saved during this run,
// so a job that was already waiting before the run is never touched.
import { randomUUID } from "node:crypto";
import type { CollectionIssue } from "../types/collection-issue";
import type { AddedJobOutcome } from "../types/added-job-outcome";
import { associateCompanies } from "../handlers/association";
import { classifyJobs } from "../handlers/classification";
import type { AtsSlugService } from "../services/ats-slug-service";
import type { CompanyService } from "../services/company-service";
import { dedupeJobs } from "../handlers/dedupe";
import { letJobsThrough } from "../handlers/let-through";
import type { JobListEntry } from "../types/job-list-entry";
import type { JobService } from "../services/job-service";
import { normalizeJobs } from "../handlers/normalization";
import { parseJobs } from "../handlers/parsing";
import { resolveJobs } from "../handlers/resolution";
import type { Parser } from "../parsers/parser";
import type { ResolutionBrowserFactory, ResolutionPage } from "../tools/resolution-page";
import { createRenderedPageBrowser, type RenderedPageBrowser, type RenderedPageLauncher } from "../tools/rendered-page-fetcher";
import { saveJobs } from "../handlers/save";
import type { PlaceService } from "../services/place-service";
import type { Geocoder } from "../tools/geocoder";
import type { SettingsService } from "../services/settings-service";
import { createFailureTracker, type RunFailure } from "../utils/run-failure";
import type { TitleVocabularies } from "../utils/title";
import type { TraceJobRecord, TraceJobRowsReader, TraceService } from "../services/trace-service";
import { isRecheckedStatus } from "../utils/job-status";
import { urlMatchKey } from "../utils/url-match-key";
import type { FinishedHandler } from "./job-search";

// The name every added job and every refusal warning is filed under.
const USER_COLLECTOR = "user";

export interface ExternalJobSubmission {
  link: string;
  title?: string;
  employer?: string;
  description?: string;
}

export interface RunAddExternalJobsResult {
  outcomes: AddedJobOutcome[];
  warnings: CollectionIssue[];
  handlers: FinishedHandler[];
  failure: RunFailure | null;
  traceFailures: number;
}

export interface RunAddExternalJobsOptions {
  submissions: ExternalJobSubmission[];
  settings: SettingsService;
  companies: CompanyService;
  atsSlugs: AtsSlugService;
  jobService: JobService;
  openBrowser: ResolutionBrowserFactory;
  waitForLoad?: (page: ResolutionPage) => Promise<void>;
  parserFor?: (url: string) => Parser | null;
  launchParsingBrowser?: RenderedPageLauncher;
  places: PlaceService;
  geocoder: Geocoder;
  collectedAt: Date;
  runId: string;
  trace: TraceService & TraceJobRowsReader;
  log?: (message: string) => void;
}

type HandlerResult = | { jobs: unknown[]; companies?: never } | { companies: unknown[]; jobs?: never };

function entriesIn(result: HandlerResult): number {
  return result.jobs === undefined ? result.companies.length : result.jobs.length;
}

function isWebAddress(link: string): boolean {
  try {
    new URL(link);
    return true;
  } catch {
    return false;
  }
}

export async function runAddExternalJobs(options: RunAddExternalJobsOptions): Promise<RunAddExternalJobsResult> {
  const report: RunAddExternalJobsResult = { outcomes: [], warnings: [], handlers: [], failure: null, traceFailures: 0 };
  const failures = createFailureTracker();
  const at = failures.at;
  async function handler<T extends HandlerResult>(step: string, run: () => Promise<T>): Promise<T> {
    const result = await at(step, run);
    report.handlers.push({ step, entries: entriesIn(result) });
    return result;
  }

  // Every job a save hands back joins this set. A job merged into a saved row
  // continues under that row's id, which the save hands back.
  const tracked = new Set<string>();
  function track(jobs: JobListEntry[]): void {
    for (const job of jobs) if (job.id) tracked.add(job.id);
  }

  // Kept outside the try so the outcomes can still be looked up after a stop.
  let identifyingQueryValues: readonly string[] | undefined;

  try {
    const expiryThresholdDays = await at("expiry_threshold", () => options.settings.getExpiryThreshold());
    const priorityList = await at("source_priority_list", () => options.settings.getSourcePriorityList());
    const queryValues = await at("identifying_query_values", () => options.settings.getIdentifyingQueryValues());
    identifyingQueryValues = queryValues;
    const vocabularies = await at<TitleVocabularies>("title_vocabularies", async () => ({
      headNouns: await options.settings.getTitleHeadNouns(),
      levels: await options.settings.getTitleLevels(),
      suffixes: await options.settings.getTitleSuffixes(),
      removalWords: await options.settings.getTitleRemovalWords(),
    }));

    // No status or flag is set here. Merging into a saved row copies a status
    // that is present, and leaves the saved row's own status when none is.
    const firstList: JobListEntry[] = [];
    for (const submission of options.submissions) {
      if (!isWebAddress(submission.link)) {
        report.warnings.push({ collector: USER_COLLECTOR, message: `refused "${submission.link}": not a web address` });
        continue;
      }
      firstList.push({
        id: randomUUID(),
        collector: USER_COLLECTOR,
        collected_at: options.collectedAt,
        original_url: submission.link,
        ...(submission.title === undefined ? {} : { raw_title: submission.title }),
        ...(submission.employer === undefined ? {} : { raw_company_name: submission.employer }),
        ...(submission.description === undefined ? {} : { description: submission.description }),
      });
    }

    const normalized = await handler("post_collection_normalization", () =>
      normalizeJobs(firstList, { vocabularies, trace: options.trace, runId: options.runId, step: "post_collection_normalization" }));
    report.warnings.push(...normalized.warnings);
    const associated = await handler("post_collection_association", () =>
      associateCompanies(normalized.jobs, { companies: options.companies, atsSlugs: options.atsSlugs, trace: options.trace, runId: options.runId, step: "post_collection_association" }));
    report.warnings.push(...associated.warnings);
    const deduped = await handler("post_collection_dedupe", () =>
      dedupeJobs(associated.jobs, { jobService: options.jobService, priorityList, identifyingQueryValues: queryValues, collectedAt: options.collectedAt, trace: options.trace, runId: options.runId, step: "post_collection_dedupe" }));
    report.warnings.push(...deduped.warnings);
    const saved = await handler("post_collection_save", () =>
      saveJobs(deduped.jobs, { jobService: options.jobService, priorityList, identifyingQueryValues: queryValues, trace: options.trace, runId: options.runId, step: "post_collection_save" }));
    report.warnings.push(...saved.warnings);
    track(saved.jobs);

    // A link matching a saved job with a rechecked verdict goes back to the
    // backlog with every step undone, so this run checks the posting again.
    const matchedRows = await at("verdict_lookup", () => options.jobService.findByIds([...tracked]));
    const resets: JobListEntry[] = matchedRows
      .filter(({ job }) => job.status !== undefined && job.status !== null && isRecheckedStatus(job.status))
      .map(({ job }) => ({ id: job.id, collector: job.collector, status: "backlog", is_resolved: false, is_parsed: false, is_classified: false }));
    const reset = await handler("verdict_reset_save", () =>
      saveJobs(resets, { jobService: options.jobService, priorityList, identifyingQueryValues: queryValues, trace: options.trace, runId: options.runId, step: "post_collection_save" }));
    report.warnings.push(...reset.warnings);
    track(reset.jobs);

    const unresolved = await at("unresolved_lookup", () => options.jobService.findBacklogByIds([...tracked], "resolution"));
    // A headed browser holds the machine for as long as it runs, so a list with
    // nothing to resolve must never reach the point of launching one.
    if (unresolved.length > 0) {
      const fastConcurrency = await at("resolution_fast_concurrency", () => options.settings.getResolutionFastConcurrency());
      const slowConcurrency = await at("resolution_slow_concurrency", () => options.settings.getResolutionSlowConcurrency());
      const slowPauseSeconds = await at("resolution_slow_pause_seconds", () => options.settings.getResolutionSlowPauseSeconds());
      const browser = await at("browser_launch", () => options.openBrowser());
      try {
        const resolved = await handler("resolution", () =>
          resolveJobs(unresolved, { openPage: browser.openPage, fastConcurrency, slowConcurrency,
            slowPauseMs: slowPauseSeconds * 1000, waitForLoad: options.waitForLoad,
            trace: options.trace, runId: options.runId, step: "resolution" }));
        report.warnings.push(...resolved.warnings);
        const resolvedDeduped = await handler("post_resolution_dedupe", () =>
          dedupeJobs(resolved.jobs, { jobService: options.jobService, priorityList, identifyingQueryValues: queryValues, collectedAt: options.collectedAt, trace: options.trace, runId: options.runId, step: "post_resolution_dedupe" }));
        report.warnings.push(...resolvedDeduped.warnings);
        const resolvedSaved = await handler("post_resolution_save", () =>
          saveJobs(resolvedDeduped.jobs, { jobService: options.jobService, priorityList, identifyingQueryValues: queryValues, trace: options.trace, runId: options.runId, step: "post_resolution_save" }));
        report.warnings.push(...resolvedSaved.warnings);
        track(resolvedSaved.jobs);
      } finally {
        await at("browser_close", () => browser.close());
      }
    }

    // This read does not ask whether the link was followed, so a job whose
    // link was refused is still read, finds no place, and is marked unparseable.
    const unparsed = await at("unparsed_lookup", () => options.jobService.findBacklogByIds([...tracked], "parsing"));
    const parsed = await (async () => {
      let session: RenderedPageBrowser | undefined;
      const readRenderedPage = async (url: string): Promise<string> => {
        if (!session) session = await createRenderedPageBrowser(options.launchParsingBrowser);
        return session.fetch(url);
      };
      try {
        return await handler("parsing", () =>
          parseJobs(unparsed, { parserFor: options.parserFor, readRenderedPage, referenceInstant: options.collectedAt,
            trace: options.trace, runId: options.runId, step: "parsing" }));
      } finally {
        const opened = session;
        if (opened) await at("parsing_browser_close", () => opened.close());
      }
    })();
    report.warnings.push(...parsed.warnings);
    const parsedNormalized = await handler("post_parsing_normalization", () =>
      normalizeJobs(parsed.jobs, { vocabularies, trace: options.trace, runId: options.runId, step: "post_parsing_normalization" }));
    report.warnings.push(...parsedNormalized.warnings);
    const parsedAssociated = await handler("post_parsing_association", () =>
      associateCompanies(parsedNormalized.jobs, { companies: options.companies, atsSlugs: options.atsSlugs, trace: options.trace, runId: options.runId, step: "post_parsing_association" }));
    report.warnings.push(...parsedAssociated.warnings);
    const parsedDeduped = await handler("post_parsing_dedupe", () =>
      dedupeJobs(parsedAssociated.jobs, { jobService: options.jobService, priorityList, identifyingQueryValues: queryValues, collectedAt: options.collectedAt, trace: options.trace, runId: options.runId, step: "post_parsing_dedupe" }));
    report.warnings.push(...parsedDeduped.warnings);
    // The user picked these jobs by hand, so one the pipeline could not read
    // stays in the backlog instead of being dropped.
    const parsedLetThrough = await handler("post_parsing_let_through", () =>
      letJobsThrough(parsedDeduped.jobs, { after: "parsing", trace: options.trace, runId: options.runId, step: "post_parsing_let_through" }));
    const parsedSaved = await handler("post_parsing_save", () =>
      saveJobs(parsedLetThrough.jobs, { jobService: options.jobService, priorityList, identifyingQueryValues: queryValues, trace: options.trace, runId: options.runId, step: "post_parsing_save" }));
    report.warnings.push(...parsedSaved.warnings);
    track(parsedSaved.jobs);

    // Read only now, so a missing location stops the run after the first
    // three stretches have finished.
    const area = await at("home_location", async () => {
      const locationText = await options.settings.getLocation();
      const radiusMiles = await options.settings.getRadius();
      const known = await options.places.findByText(locationText);
      if (known) return { home: { latitude: known.latitude, longitude: known.longitude }, radiusMiles };
      const found = await options.geocoder.lookUp(locationText);
      await options.places.store(locationText, found);
      if (!found) throw new Error(`The location setting "${locationText}" has no coordinates`);
      return { home: { latitude: found.latitude, longitude: found.longitude }, radiusMiles };
    });
    const repostGapDays = await at("repost_gap", () => options.settings.getRepostGapDays());

    const unclassified = await at("classification_lookup", () => options.jobService.findBacklogByIds([...tracked], "classification"));
    const classified = await handler("classification", () =>
      classifyJobs(unclassified, { repostGapDays, expiryThresholdDays, referenceInstant: options.collectedAt,
        home: area.home, radiusMiles: area.radiusMiles, places: options.places, geocoder: options.geocoder,
        trace: options.trace, runId: options.runId, step: "classification" }));
    const classifiedLetThrough = await handler("post_classification_let_through", () =>
      letJobsThrough(classified.jobs, { after: "classification", trace: options.trace, runId: options.runId, step: "post_classification_let_through" }));
    const classifiedSaved = await handler("post_classification_save", () =>
      saveJobs(classifiedLetThrough.jobs, { jobService: options.jobService, priorityList, identifyingQueryValues: queryValues, trace: options.trace, runId: options.runId, step: "post_classification_save" }));
    report.warnings.push(...classifiedSaved.warnings);
    track(classifiedSaved.jobs);
  } catch {
    // `at` named the spot and wrote the reason on its way past.
  }
  report.traceFailures = options.trace.failureCount();

  // Every submission starts out as refused or not saved. A job found for it
  // below fills in the rest.
  report.outcomes = options.submissions.map((submission) => ({
    link: submission.link,
    jobId: null,
    title: submission.title ?? null,
    employer: submission.employer ?? null,
    status: null,
    reason: isWebAddress(submission.link) ? "not saved" : "not a web address",
    letThroughReasons: [],
  }));

  try {
    const queryValues = identifyingQueryValues;
    if (queryValues) {
      await at("outcome_lookup", async () => {
        // Found by the same link key duplicate checking matches on, so two
        // links to one posting land on one job.
        const jobIds: (string | null)[] = [];
        for (const submission of options.submissions) {
          if (!isWebAddress(submission.link)) {
            jobIds.push(null);
            continue;
          }
          const key = urlMatchKey(submission.link, queryValues);
          const [found] = key ? await options.jobService.findByOriginalUrlMatchKey(key) : [];
          jobIds.push(found?.id ?? null);
        }

        const ids = [...new Set(jobIds.filter((id): id is string => id !== null))];
        if (ids.length === 0) return;
        const rows = await options.jobService.findByIds(ids);
        const traceRows = await options.trace.rowsForJobs(options.runId, ids);

        const rowById = new Map(rows.map((row) => [row.job.id, row]));
        // Each job's trace rows, still in the order they were written.
        const traceById = new Map<string, TraceJobRecord[]>();
        for (const traceRow of traceRows) {
          const list = traceById.get(traceRow.job_id) ?? [];
          list.push(traceRow);
          traceById.set(traceRow.job_id, list);
        }

        options.submissions.forEach((submission, index) => {
          const jobId = jobIds[index];
          if (!jobId) return;
          const row = rowById.get(jobId);
          const jobTrace = traceById.get(jobId) ?? [];
          const status = row?.job.status ?? null;
          const letThrough = jobTrace.some((traceRow) => traceRow.event === "job_let_through");
          const lastReason = [...jobTrace].reverse().find((traceRow) => traceRow.reason !== null)?.reason ?? null;
          report.outcomes[index] = {
            link: submission.link,
            jobId,
            title: row?.job.raw_title ?? row?.job.title ?? submission.title ?? null,
            employer: row?.company?.name ?? row?.job.raw_company_name ?? submission.employer ?? null,
            status,
            reason: status === "backlog" ? null : lastReason,
            letThroughReasons: letThrough
              ? jobTrace
                .filter((traceRow) => traceRow.event === "resolution_failed" || traceRow.event === "job_let_through")
                .flatMap((traceRow) => (traceRow.reason === null ? [] : [traceRow.reason]))
              : [],
          };
        });
      });
    }
  } catch {
    // `at` recorded the spot. The tracker keeps whichever failure came first.
  }

  report.failure = failures.failure();
  return report;
}
