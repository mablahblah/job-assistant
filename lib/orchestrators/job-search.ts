// Runs the job search, calling one handler after another and handing each the
// run id, the collection date and the services they share. Three steps run in
// sequence, and each ends in a database write, so a run's work outlives the
// run whether or not the next step gets to it. The collect step is collection,
// normalization, association, dedupe and save. The resolution step then reads
// its own list of jobs still needing a source URL — nothing upstream hands it
// work, because the database is the only handoff between steps — resolves them
// behind one shared browser, then dedupes and saves what came back. The
// parsing step reads its own list of jobs already resolved but not yet parsed,
// reads each with the parser that owns its link's domain, then normalizes,
// associates, dedupes and saves.
//
// A throw anywhere in that chain stops the run where it happened rather than
// escaping to the caller. Every step has already written to the database by
// the time a later one can fail, so the run's finished work survives, and the
// report carries it along with the spot that threw and the reason.
import type { CollectionIssue } from "../types/collection-issue";
import type { Collector } from "../collectors/collector";
import { associateCompanies } from "../handlers/association";
import { cleanBacklogCompanies, cleanBacklogJobs } from "../handlers/backlog-cleanup";
import { classifyJobs } from "../handlers/classification";
import { promoteJobs } from "../handlers/promotion";
import { collectJobs } from "../handlers/collection";
import type { AtsSlugService } from "../services/ats-slug-service";
import type { CompanyService } from "../services/company-service";
import { dedupeJobs } from "../handlers/dedupe";
import type { JobListEntry } from "../types/job-list-entry";
import type { JobService } from "../services/job-service";
import { normalizeJobs } from "../handlers/normalization";
import { parseJobs } from "../handlers/parsing";
import { resolveJobs } from "../handlers/resolution";
import type { Parser } from "../parsers/parser";
import type { ResolutionBrowserFactory, ResolutionPage } from "../tools/resolution-page";
import {
  createRenderedPageBrowser,
  type RenderedPageBrowser,
  type RenderedPageLauncher,
} from "../tools/rendered-page-fetcher";
import { saveCompanies, saveJobs } from "../handlers/save";
import type { PlaceService } from "../services/place-service";
import type { Geocoder } from "../tools/geocoder";
import type { SettingsService } from "../services/settings-service";
import { createFailureTracker, type RunFailure } from "../utils/run-failure";
import type { TitleVocabularies } from "../utils/title";
import type { TraceService } from "../services/trace-service";

export interface FinishedHandler {
  // The position this handler ran at, which is usually the `Trace.step` its
  // rows carry: one dedupe handler runs at three positions. The two company
  // cleanup labels are the exception; their rows carry the jobs' cleanup steps.
  step: string;
  // How many entries the list it handed back held. Entries rather than jobs,
  // because a handler may be handed any list: most are handed jobs, and the
  // one that clears stale company scores is handed companies.
  entries: number;
}

// What a handler hands back: the list it acted on, under the name of what is
// in it. Spelling the other name as never is what stops a result carrying
// both, which would leave the count below picking one arbitrarily.
type HandlerResult =
  | { jobs: unknown[]; companies?: never }
  | { companies: unknown[]; jobs?: never };

function entriesIn(result: HandlerResult): number {
  return result.jobs === undefined ? result.companies.length : result.jobs.length;
}

// The same shape the scoring runner reports, so it is declared once beside
// the tracker that fills it in rather than separately in each runner.
export type RunJobSearchFailure = RunFailure;

export interface RunJobSearchResult {
  jobs: JobListEntry[];
  // How many companies lost all four scores during backlog cleanup, and how
  // many lost only the categories that were guessed. The summary says both.
  companyScoresCleared: number;
  companyGuessesCleared: number;
  errors: CollectionIssue[];
  warnings: CollectionIssue[];
  // One entry per handler that finished, in run order. A handler that threw
  // never finished, so it earns no entry here — it is named in `failure`
  // instead, and this list is what the run got through before it.
  handlers: FinishedHandler[];
  // Where the run stopped and why, or null when nothing threw. Always
  // present, never optional, for the reason traceFailures below is: a caller
  // should not have to check whether the field exists before reading it.
  failure: RunJobSearchFailure | null;
  // How many trace writes this run lost. Always present, 0 when nothing
  // failed, so a caller never has to check whether the field exists before
  // reading it.
  traceFailures: number;
}

export interface RunJobSearchOptions {
  settings: SettingsService;
  collectors: Collector[];
  // Required, not optional: association is what gives a job the company
  // identity dedupe later matches on, so a caller can't forget it and have
  // the orchestrator silently skip it.
  companies: CompanyService;
  // Required, not optional, for the same reason again: a caller that omitted
  // it would have the pipeline learn nothing about which boards its employers
  // post on, and promotion would have no row to put a collector on.
  atsSlugs: AtsSlugService;
  // Required, not optional, for the same reason: a caller that omitted it
  // would have the run end without writing a row, which is what a run that
  // found nothing also looks like.
  jobService: JobService;
  // Required, not optional, for the same reason again: a caller that omitted
  // it would have the resolution step silently skip, which reads the same as a
  // run that had nothing left to resolve.
  openBrowser: ResolutionBrowserFactory;
  // The substitution point that lets the resolution step be tested offline against scripted
  // pages. Left out, resolution settles a page the way it does in a browser.
  waitForLoad?: (page: ResolutionPage) => Promise<void>;
  // The substitution point that lets the parsing step be tested offline
  // against stand-in parsers. Left out, parsing looks a parser up in the real
  // registry.
  parserFor?: (url: string) => Parser | null;
  // The substitution point that lets parsing be tested offline against a
  // scripted browser session. Left out, parsing opens the real headless
  // browser the first time a page needs one.
  launchParsingBrowser?: RenderedPageLauncher;
  // Required, not optional, for the same reason again: classification needs a
  // place to look coordinates up in and a mapping service to fill it, and a
  // caller that omitted either would have the run judge nothing, which reads
  // the same as a run that had nothing left to judge.
  places: PlaceService;
  geocoder: Geocoder;
  // The date written into every job's collected_at. It is also the instant
  // every age in the run is measured against, so a run that spends half an
  // hour in a browser judges its last job against the same moment as its
  // first. It arrives as an argument so the orchestrator reads no clock.
  collectedAt: Date;
  // Identifies one job search so every trace event it produces can be
  // grouped and compared against other searches. Minted by the caller;
  // the orchestrator never generates one itself.
  runId: string;
  // Records each job's path through collection. Never throws: a failed write
  // is ignored and counted rather than allowed to cancel a run over a row
  // of diagnostics.
  trace: TraceService;
  // How many jobs each collector stops after. Omitted means unlimited.
  limit?: number;
  // Where progress lines go. Defaults to stderr, so a job list printed on
  // stdout stays clean.
  log?: (message: string) => void;
}

export async function runJobSearch(options: RunJobSearchOptions): Promise<RunJobSearchResult> {
  const report: RunJobSearchResult = {
    jobs: [],
    companyScoresCleared: 0,
    companyGuessesCleared: 0,
    errors: [],
    warnings: [],
    handlers: [],
    failure: null,
    traceFailures: 0,
  };

  // Names the spot for the report and runs it, recording a throw before
  // letting it carry on to the one catch below. The name is passed in rather
  // than tracked in a variable the next line has to remember to update, so a
  // handler added by a later phase cannot be reported under the last one's
  // name. The tracker is shared with the scoring runner, which is what keeps
  // the two from drifting on which failure a run reports.
  const failures = createFailureTracker();
  const at = failures.at;

  // The same, for a handler, which additionally earns its line on the
  // finished list. A handler that threw never reaches the push, because the
  // throw leaves through `at` above.
  //
  // The result is read for a list under either name rather than for jobs
  // alone, because a handler may be handed any list. Most hand back jobs; the
  // one that clears stale company scores hands back companies.
  async function handler<T extends HandlerResult>(
    step: string,
    run: () => Promise<T>
  ): Promise<T> {
    const result = await at(step, run);
    report.handlers.push({ step, entries: entriesIn(result) });
    return result;
  }

  try {
    // Read once for the whole run, because backlog cleanup, promotion and
    // classification all judge age, and a run where they disagreed about what
    // counts as expired would contradict itself.
    const expiryThresholdDays = await at("expiry_threshold", () =>
      options.settings.getExpiryThreshold()
    );

    // Read here for the same reason: every company in one run is judged
    // against one pair of thresholds and one instant.
    const scoreExpiryDays = await at("score_expiry_days", () =>
      options.settings.getScoreExpiryDays()
    );
    const guessedScoreExpiryDays = await at("guessed_score_expiry_days", () =>
      options.settings.getGuessedScoreExpiryDays()
    );

    // Read here rather than after collection, because the backlog cleanup save
    // below is now the run's first write and every later save reuses it.
    const priorityList = await at("source_priority_list", () =>
      options.settings.getSourcePriorityList()
    );

    // Read once per run, like the priority list, so every duplicate check and
    // save keys UltiPro links consistently. A missing setting stops the run,
    // because linking without it would fold different openings into one.
    const identifyingQueryValues = await at("identifying_query_values", () =>
      options.settings.getIdentifyingQueryValues()
    );

    // Cleanup opens the run, so the backlog collection is about to add to has
    // already been swept rather than being judged a step behind.
    const backlog = await at("backlog_lookup", () => options.jobService.findBacklog());

    const cleanedBacklog = await handler("backlog_cleanup", () =>
      cleanBacklogJobs(backlog, {
        expiryThresholdDays,
        referenceInstant: options.collectedAt,
        trace: options.trace,
        runId: options.runId,
        step: "backlog_cleanup",
      })
    );

    // The company half of the same sweep, at the same position. A judgement
    // about an employer ages the way a posting does, and a company whose
    // scores are emptied here is researched again when scoring runs.
    const scoredCompanies = await at("scored_company_lookup", () =>
      options.companies.findScored()
    );

    const cleanedCompanies = await handler("backlog_cleanup_companies", () =>
      cleanBacklogCompanies(scoredCompanies, {
        scoreExpiryDays,
        guessedScoreExpiryDays,
        referenceInstant: options.collectedAt,
        trace: options.trace,
        runId: options.runId,
        step: "backlog_cleanup",
      })
    );
    report.companyScoresCleared = cleanedCompanies.scoresCleared;
    report.companyGuessesCleared = cleanedCompanies.guessesCleared;

    const companiesSaved = await handler("backlog_cleanup_company_save", () =>
      saveCompanies(cleanedCompanies.companies, {
        companyService: options.companies,
        trace: options.trace,
        runId: options.runId,
        step: "post_backlog_cleanup_save",
      })
    );
    report.warnings.push(...companiesSaved.warnings);

    const backlogSaved = await handler("post_backlog_cleanup_save", () =>
      saveJobs(cleanedBacklog.jobs, {
        jobService: options.jobService,
        priorityList,
        identifyingQueryValues,
        trace: options.trace,
        runId: options.runId,
        step: "post_backlog_cleanup_save",
      })
    );
    report.warnings.push(...backlogSaved.warnings);

    // The collection handler owns the collectors, the job ids and the usability
    // check, and hands back the first job list of the run.
    const collected = await handler("collection", () =>
      collectJobs({
        settings: options.settings,
        atsSlugs: options.atsSlugs,
        collectors: options.collectors,
        collectedAt: options.collectedAt,
        runId: options.runId,
        trace: options.trace,
        limit: options.limit,
        log: options.log,
      })
    );
    report.jobs = collected.jobs;
    report.errors = collected.errors;
    // Pushed, never assigned: the backlog cleanup save above has already
    // raised warnings of its own, and assigning here would throw them away.
    report.warnings.push(...collected.warnings);

    // Read before the handlers run, deliberately: a missing title vocabulary
    // means the settings service throws, and that has to stop the whole run
    // rather than read as one handler failing.
    const vocabularies = await at<TitleVocabularies>("title_vocabularies", async () => ({
      headNouns: await options.settings.getTitleHeadNouns(),
      levels: await options.settings.getTitleLevels(),
      suffixes: await options.settings.getTitleSuffixes(),
      removalWords: await options.settings.getTitleRemovalWords(),
    }));

    // One call with every collector's surviving jobs, which is what a handler
    // is handed. It writes its own trace rows and hands back the warnings it
    // raised, folded to one line per collector rather than one per job.
    const normalized = await handler("post_collection_normalization", () =>
      normalizeJobs(report.jobs, {
        vocabularies,
        trace: options.trace,
        runId: options.runId,
        step: "post_collection_normalization",
      })
    );
    report.jobs = normalized.jobs;
    report.warnings.push(...normalized.warnings);

    // Association gives each surviving job the company identity dedupe later
    // matches on, so it runs over the same list normalization produced.
    const associated = await handler("post_collection_association", () =>
      associateCompanies(report.jobs, {
        companies: options.companies,
        atsSlugs: options.atsSlugs,
        trace: options.trace,
        runId: options.runId,
        step: "post_collection_association",
      })
    );
    report.jobs = associated.jobs;
    report.warnings.push(...associated.warnings);

    // Dedupe reduces the list to one entry per real posting, matching on the
    // company identity association just attached to each job.
    const deduped = await handler("post_collection_dedupe", () =>
      dedupeJobs(report.jobs, {
        jobService: options.jobService,
        priorityList,
        identifyingQueryValues,
        collectedAt: options.collectedAt,
        trace: options.trace,
        runId: options.runId,
        step: "post_collection_dedupe",
      })
    );
    report.jobs = deduped.jobs;
    report.warnings.push(...deduped.warnings);

    // Save writes what survives into rows and deletes what dedupe marked, so
    // the collect step ends in the database rather than in a list nothing
    // outlives.
    const saved = await handler("post_collection_save", () =>
      saveJobs(report.jobs, {
        jobService: options.jobService,
        priorityList,
        identifyingQueryValues,
        trace: options.trace,
        runId: options.runId,
        step: "post_collection_save",
      })
    );
    report.jobs = saved.jobs;
    report.warnings.push(...saved.warnings);

    // The resolution step takes no job list from the collect step — it queries
    // the database for whatever still needs a source URL, which is what lets
    // this step run over jobs collected by any earlier run as well. A collect
    // step that threw never arrives here, because the throw has already left
    // for the catch below.
    const unresolved = await at("unresolved_lookup", () => options.jobService.findUnresolved());

    // A headed browser holds the machine for as long as it runs, so a list with
    // nothing to resolve must never reach the point of launching one.
    if (unresolved.length > 0) {
      // Read before the browser is launched, deliberately: a missing setting
      // throws, and throwing here costs no browser rather than opening one for
      // a run that cannot go ahead.
      const fastConcurrency = await at("resolution_fast_concurrency", () =>
        options.settings.getResolutionFastConcurrency()
      );
      const slowConcurrency = await at("resolution_slow_concurrency", () =>
        options.settings.getResolutionSlowConcurrency()
      );
      const slowPauseSeconds = await at("resolution_slow_pause_seconds", () =>
        options.settings.getResolutionSlowPauseSeconds()
      );

      const browser = await at("browser_launch", () => options.openBrowser());

      try {
        const resolved = await handler("resolution", () =>
          resolveJobs(unresolved, {
            openPage: browser.openPage,
            fastConcurrency,
            slowConcurrency,
            // Stored in seconds because that is the unit a person tuning it
            // against a source that pushed back thinks in.
            slowPauseMs: slowPauseSeconds * 1000,
            waitForLoad: options.waitForLoad,
            trace: options.trace,
            runId: options.runId,
            step: "resolution",
          })
        );
        report.warnings.push(...resolved.warnings);

        // Dedupe reduces the list to one entry per real posting, now that
        // resolution has given every job the source URL identity is judged on.
        const resolvedDeduped = await handler("post_resolution_dedupe", () =>
          dedupeJobs(resolved.jobs, {
            jobService: options.jobService,
            priorityList,
            identifyingQueryValues,
            collectedAt: options.collectedAt,
            trace: options.trace,
            runId: options.runId,
            step: "post_resolution_dedupe",
          })
        );
        report.warnings.push(...resolvedDeduped.warnings);

        // Save writes what survives and deletes what dedupe marked, so the
        // resolution step also ends in the database rather than in a list
        // nothing outlives.
        const resolvedSaved = await handler("post_resolution_save", () =>
          saveJobs(resolvedDeduped.jobs, {
            jobService: options.jobService,
            priorityList,
            identifyingQueryValues,
            trace: options.trace,
            runId: options.runId,
            step: "post_resolution_save",
          })
        );
        report.warnings.push(...resolvedSaved.warnings);

        // The report lists every job the run acted on, so the two steps' saved
        // lists are joined on id. The resolution step's version wins, because it
        // ran later and its fields are newer. A job carrying no id is appended
        // rather than matched: save itself treats a missing id as possible, and
        // two jobs without one are two jobs rather than one seen twice.
        for (const job of resolvedSaved.jobs) {
          const existing = job.id
            ? report.jobs.findIndex((entry) => entry.id === job.id)
            : -1;
          if (existing === -1) {
            report.jobs.push(job);
          } else {
            report.jobs[existing] = job;
          }
        }
      } finally {
        // A throw from anywhere in this step must still close the browser it
        // opened, and the close is named in its own right so a browser that
        // will not shut is not reported as whatever ran before it.
        await at("browser_close", () => browser.close());
      }
    }

    // The parsing step reads its own list too: jobs already resolved but not
    // yet parsed. Nothing upstream hands it work, because the database is the
    // only handoff between steps. Unlike resolution it guards nothing behind a
    // length check, because five handlers over an empty list cost nothing —
    // and no browser opens here until some parser actually asks for one.
    const unparsed = await at("unparsed_lookup", () => options.jobService.findUnparsed());

    const parsed = await (async () => {
      // A browser is the pipeline's most expensive step and most searches
      // never need one, so it's opened lazily — only on the first page a
      // parser actually asks to be rendered — and every later page in this
      // run reuses that same session.
      let session: RenderedPageBrowser | undefined;
      const readRenderedPage = async (url: string): Promise<string> => {
        if (!session) {
          session = await createRenderedPageBrowser(options.launchParsingBrowser);
        }
        return session.fetch(url);
      };

      try {
        return await handler("parsing", () =>
          parseJobs(unparsed, {
            parserFor: options.parserFor,
            readRenderedPage,
            referenceInstant: options.collectedAt,
            trace: options.trace,
            runId: options.runId,
            step: "parsing",
          })
        );
      } finally {
        // Only close what was opened. If no parser ever asked for a rendered
        // page, `session` stays undefined and nothing is launched or closed.
        const opened = session;
        if (opened) {
          // A throw from anywhere in this step must still close the browser
          // it opened, and the close is named in its own right so a browser
          // that will not shut is not reported as whatever ran before it.
          await at("parsing_browser_close", () => opened.close());
        }
      }
    })();
    report.warnings.push(...parsed.warnings);

    // Normalization runs before association, not after: association matches on
    // the cleaned company name and normalization is what cleans it, so running
    // association first would split one employer across two company rows.
    const parsedNormalized = await handler("post_parsing_normalization", () =>
      normalizeJobs(parsed.jobs, {
        vocabularies,
        trace: options.trace,
        runId: options.runId,
        step: "post_parsing_normalization",
      })
    );
    report.warnings.push(...parsedNormalized.warnings);

    const parsedAssociated = await handler("post_parsing_association", () =>
      associateCompanies(parsedNormalized.jobs, {
        companies: options.companies,
        atsSlugs: options.atsSlugs,
        trace: options.trace,
        runId: options.runId,
        step: "post_parsing_association",
      })
    );
    report.warnings.push(...parsedAssociated.warnings);

    const parsedDeduped = await handler("post_parsing_dedupe", () =>
      dedupeJobs(parsedAssociated.jobs, {
        jobService: options.jobService,
        priorityList,
        identifyingQueryValues,
        collectedAt: options.collectedAt,
        trace: options.trace,
        runId: options.runId,
        step: "post_parsing_dedupe",
      })
    );
    report.warnings.push(...parsedDeduped.warnings);

    const parsedSaved = await handler("post_parsing_save", () =>
      saveJobs(parsedDeduped.jobs, {
        jobService: options.jobService,
        priorityList,
        identifyingQueryValues,
        trace: options.trace,
        runId: options.runId,
        step: "post_parsing_save",
      })
    );
    report.warnings.push(...parsedSaved.warnings);

    // The point every job is measured against is settled once per run. The
    // coordinates are looked up the way any place is — ask the place service
    // first, and only pay the mapping service when it has never seen this text.
    // A location that cannot be placed on a map ends the run, because measuring
    // against nothing would mark every job as not matching.
    const area = await at("home_location", async () => {
      const locationText = await options.settings.getLocation();
      const radiusMiles = await options.settings.getRadius();

      const known = await options.places.findByText(locationText);
      if (known) {
        return { home: { latitude: known.latitude, longitude: known.longitude }, radiusMiles };
      }

      const found = await options.geocoder.lookUp(locationText);
      // The service stores nothing for an empty answer, so an unplaceable
      // location is tried again next run rather than remembered as a dead end.
      await options.places.store(locationText, found);
      if (!found) {
        throw new Error(`The location setting "${locationText}" has no coordinates`);
      }
      return { home: { latitude: found.latitude, longitude: found.longitude }, radiusMiles };
    });

    const repostGapDays = await at("repost_gap", () => options.settings.getRepostGapDays());

    // Promotion closes the run rather than opening it: an expired job only
    // earns a fresh date once collection has found the new listing and dedupe
    // has merged it in, so running it earlier would find nothing to promote.
    const promotable = await at("promotion_lookup", () =>
      options.jobService.findExpiredWithin(expiryThresholdDays, options.collectedAt)
    );

    const promoted = await handler("promotion", () =>
      promoteJobs(promotable, {
        trace: options.trace,
        runId: options.runId,
        step: "promotion",
      })
    );

    const promotionSaved = await handler("post_promotion_save", () =>
      saveJobs(promoted.jobs, {
        jobService: options.jobService,
        priorityList,
        identifyingQueryValues,
        trace: options.trace,
        runId: options.runId,
        step: "post_promotion_save",
      })
    );
    report.warnings.push(...promotionSaved.warnings);

    // Read after promotion's save, so the jobs promotion just returned to the
    // backlog are judged by this run rather than waiting for the next one.
    const unclassified = await at("classification_lookup", () =>
      options.jobService.findUnclassified()
    );

    const classified = await handler("classification", () =>
      classifyJobs(unclassified, {
        repostGapDays,
        expiryThresholdDays,
        referenceInstant: options.collectedAt,
        home: area.home,
        radiusMiles: area.radiusMiles,
        places: options.places,
        geocoder: options.geocoder,
        trace: options.trace,
        runId: options.runId,
        step: "classification",
      })
    );

    const classificationSaved = await handler("post_classification_save", () =>
      saveJobs(classified.jobs, {
        jobService: options.jobService,
        priorityList,
        identifyingQueryValues,
        trace: options.trace,
        runId: options.runId,
        step: "post_classification_save",
      })
    );
    report.warnings.push(...classificationSaved.warnings);

    // The report lists every job the run acted on, so the parsing step's saved
    // list is joined on id, the same way the resolution step's list before it
    // was. The parsing step's version wins, because it ran later and its
    // fields are newer. A job carrying no id is appended rather than matched:
    // save itself treats a missing id as possible, and two jobs without one
    // are two jobs rather than one seen twice.
    for (const job of parsedSaved.jobs) {
      const existing = job.id ? report.jobs.findIndex((entry) => entry.id === job.id) : -1;
      if (existing === -1) {
        report.jobs.push(job);
      } else {
        report.jobs[existing] = job;
      }
    }
  } catch {
    // Nothing to read off the throw here: `at` named the spot and wrote the
    // reason on its way past. Ignoring it is what turns a run that fell
    // over into a report rather than an exception the caller has to catch to
    // see any of the work the finished steps already wrote.
  }

  // Read once the run is over, whether it finished or stopped partway, so a
  // write either step lost is reflected in the total rather than checked step
  // by step.
  report.traceFailures = options.trace.failureCount();

  report.failure = failures.failure();
  return report;
}
