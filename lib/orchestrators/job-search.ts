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
import type { CollectionIssue } from "../collection-issue";
import type { Collector } from "../collectors/types";
import { associateCompanies } from "../handlers/association";
import { collectJobs } from "../handlers/collection";
import type { CompanyService } from "../company-service";
import { dedupeJobs } from "../handlers/dedupe";
import type { JobListEntry } from "../job-list-entry";
import type { JobService } from "../job-service";
import { normalizeJobs } from "../handlers/normalization";
import { parseJobs } from "../handlers/parsing";
import { resolveJobs } from "../handlers/resolution";
import type { Parser } from "../parsers/types";
import type { ResolutionBrowserFactory, ResolutionPage } from "../resolution-page";
import { saveJobs } from "../handlers/save";
import type { SettingsService } from "../settings-service";
import { messageFromThrown } from "../thrown-message";
import type { TitleVocabularies } from "../title";
import type { TraceService } from "../trace-service";

export interface FinishedHandler {
  // The `Trace.step` name this handler ran under. The handler is not a step:
  // one dedupe handler runs at two positions, so the position is what this
  // names and what its trace rows carry.
  step: string;
  // How many entries the list it handed back held.
  jobs: number;
}

export interface RunJobSearchFailure {
  // Where the run stopped. A handler's step name, or the name of one of the
  // reads and lookups the run makes between handlers.
  at: string;
  // Always a string, because a thrown value is not guaranteed to be an Error
  // and a report a caller has to unwrap is no report at all.
  reason: string;
}

export interface RunJobSearchResult {
  jobs: JobListEntry[];
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
  // The date written into every job's collected_at. It arrives as an
  // argument so the orchestrator reads no clock, which is what lets one run
  // share a single write and a test pin it to a fixed date.
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
  // name.
  async function at<T>(spot: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (thrown) {
      report.failure = { at: spot, reason: messageFromThrown(thrown) };
      throw thrown;
    }
  }

  // The same, for a handler, which additionally earns its line on the
  // finished list. A handler that threw never reaches the push, because the
  // throw leaves through `at` above.
  async function handler<T extends { jobs: JobListEntry[] }>(
    step: string,
    run: () => Promise<T>
  ): Promise<T> {
    const result = await at(step, run);
    report.handlers.push({ step, jobs: result.jobs.length });
    return result;
  }

  try {
    // The collection handler owns the collectors, the job ids and the usability
    // check, and hands back the first job list of the run.
    const collected = await handler("collection", () =>
      collectJobs({
        settings: options.settings,
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
    report.warnings = collected.warnings;

    // Read before the handlers run, deliberately: a missing title vocabulary
    // means the settings service throws, and that has to stop the whole run
    // rather than read as one handler failing.
    const vocabularies = await at<TitleVocabularies>("title_vocabularies", async () => ({
      headNouns: await options.settings.getTitleHeadNouns(),
      levels: await options.settings.getTitleLevels(),
      suffixes: await options.settings.getTitleSuffixes(),
      removalWords: await options.settings.getTitleRemovalWords(),
    }));

    // Read here for the same reason, and read once for the whole run: both steps
    // hand it to their dedupe and save calls, so merging the steps removes the
    // resolution step's own second read of the same list.
    const priorityList = await at("source_priority_list", () =>
      options.settings.getSourcePriorityList()
    );

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
    // length check, because there is no browser to avoid launching and five
    // handlers over an empty list cost nothing.
    const unparsed = await at("unparsed_lookup", () => options.jobService.findUnparsed());

    const parsed = await handler("parsing", () =>
      parseJobs(unparsed, {
        parserFor: options.parserFor,
        trace: options.trace,
        runId: options.runId,
        step: "parsing",
      })
    );
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
        trace: options.trace,
        runId: options.runId,
        step: "post_parsing_save",
      })
    );
    report.warnings.push(...parsedSaved.warnings);

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

  return report;
}
