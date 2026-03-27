"use client";

import { useEffect, useRef, useState } from "react";
import {
  XIcon,
  CheckCircleIcon,
  WarningIcon,
  WarningOctagonIcon,
} from "@phosphor-icons/react";
import UseAnimations from "react-useanimations";
import {
  loading,
  refresh,
  maximizeMinimize,
  filter,
  edit,
} from "@/lib/animations";
import {
  runAdzunaScrape,
  runJSearchScrape,
  runDribbbleScrape,
  runWeLoveProductScrape,
  runGreenhouseAllScrape,
  runLeverAllScrape,
  runRemotiveScrape,
  getSearchTermsAction,
} from "@/app/scraper-actions";
import { SCRAPER_CONFIG } from "@/lib/scrapers/scraper-config";
import type { ScraperSaveResult } from "@/lib/scraper-save";

// --- Types ---

// Each scraper that can run
interface ScraperDef {
  id: string;
  name: string;
  action: () => Promise<ScraperSaveResult>;
}

// Lifecycle phase for a single terminal row
type RowPhase =
  | "hidden" // not yet visible
  | "typing" // typewriter animation for "Searching..." text
  | "waiting" // fully typed, waiting for real scraper result
  | "processing" // cycling through processing sub-stages (0-3)
  | "done"; // final result displayed

// A single line in the terminal
interface TerminalRow {
  id: string; // unique: `${scraperId}-${termIndex}`
  scraperId: string;
  scraperName: string;
  termQuery: string; // the user's search term
  phase: RowPhase;
  typedChars: number; // how many chars of search text are visible
  processingStage: number; // 0-3 during processing phase
  result: ScraperSaveResult | null;
  isLastForScraper: boolean; // only the last row per scraper shows job count
  appearedAt: number; // timestamp when row first became visible (for min search duration)
  stageEnteredAt: number; // timestamp when current processing stage started (for min stage duration)
}

// --- Constants ---

// Build the list of enabled scrapers with their server actions
function getEnabledScrapers(): ScraperDef[] {
  return [
    SCRAPER_CONFIG.adzuna.enabled && {
      id: "adzuna",
      name: "Adzuna",
      action: runAdzunaScrape,
    },
    SCRAPER_CONFIG.jsearch.enabled && {
      id: "jsearch",
      name: "JSearch",
      action: runJSearchScrape,
    },
    SCRAPER_CONFIG.greenhouse.enabled && {
      id: "greenhouse",
      name: "Greenhouse",
      action: runGreenhouseAllScrape,
    },
    SCRAPER_CONFIG.lever.enabled && {
      id: "lever",
      name: "Lever",
      action: runLeverAllScrape,
    },
    SCRAPER_CONFIG.dribbble.enabled && {
      id: "dribbble",
      name: "Dribbble",
      action: runDribbbleScrape,
    },
    SCRAPER_CONFIG.weloveproduct.enabled && {
      id: "weloveproduct",
      name: "We Love Product",
      action: runWeLoveProductScrape,
    },
    SCRAPER_CONFIG.remotive.enabled && {
      id: "remotive",
      name: "Remotive",
      action: runRemotiveScrape,
    },
  ].filter(Boolean) as ScraperDef[];
}

// Processing phase display text (stage 0-3)
function getProcessingText(
  scraperName: string,
  termQuery: string,
  stage: number,
): string {
  switch (stage) {
    case 0:
      return `Processing ${scraperName} results for ${termQuery}`;
    case 1:
      return `Deduplicating ${scraperName} results for ${termQuery}`;
    case 2:
      return `Filtering out non-remote jobs outside of Austin`;
    case 3:
      return `Scoring results`;
    default:
      return "";
  }
}

// The search text that gets typewriter'd
function getSearchText(scraperName: string, termQuery: string): string {
  return `Searching ${scraperName} for ${termQuery}`;
}

// What text a row currently displays
function getRowDisplayText(row: TerminalRow): string {
  if (row.phase === "typing" || row.phase === "waiting") {
    const full = getSearchText(row.scraperName, row.termQuery);
    // During typing, show only typed chars; during waiting, show full text
    return row.phase === "typing" ? full.slice(0, row.typedChars) : full;
  }
  if (row.phase === "processing") {
    return getProcessingText(
      row.scraperName,
      row.termQuery,
      row.processingStage,
    );
  }
  if (row.phase === "done" && row.result) {
    if (row.result.error) {
      return `Search failed – ${row.result.error}`;
    }
    if (row.result.warnings && row.result.warnings.length > 0) {
      // Partial success — show count + partial indicator
      return row.isLastForScraper
        ? `${row.result.jobsNew} new jobs added (partial – ${row.result.warnings.length} failed)`
        : "Done (partial)";
    }
    // Full success
    return row.isLastForScraper
      ? `${row.result.jobsNew} new jobs added`
      : "Done";
  }
  return "";
}

// --- Timing constants ---
const TYPE_SPEED_MS = 30; // ms per character in typewriter
const MIN_SEARCH_MS = 5000; // min 5s in searching phase before transitioning
const PROCESSING_STAGE_MS = 4000; // min 4s per processing sub-stage

// --- Component ---

export default function ScraperModal({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<TerminalRow[]>([]);
  const [termsLoading, setTermsLoading] = useState(true); // loading search terms
  const started = useRef(false);
  // Store scraper results keyed by scraperId — rows check this to transition
  const scraperResults = useRef<Record<string, ScraperSaveResult>>({});
  // Ref to the terminal body for auto-scrolling
  const terminalRef = useRef<HTMLDivElement>(null);

  // Auto-scroll terminal to bottom when rows change
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [rows]);

  // Initialize: fetch search terms, build rows, fire scrapers
  useEffect(() => {
    if (started.current) return;
    started.current = true;

    async function init() {
      const terms = await getSearchTermsAction();
      if (terms.length === 0) {
        setTermsLoading(false);
        return;
      }

      const scrapers = getEnabledScrapers();

      // Build terminal rows: 1 per (scraper × search term)
      const terminalRows: TerminalRow[] = [];
      for (const scraper of scrapers) {
        terms.forEach((term, termIdx) => {
          terminalRows.push({
            id: `${scraper.id}-${termIdx}`,
            scraperId: scraper.id,
            scraperName: scraper.name,
            termQuery: term.query,
            phase: "hidden",
            typedChars: 0,
            processingStage: 0,
            result: null,
            // Last row for this scraper shows the job count
            isLastForScraper: termIdx === terms.length - 1,
            appearedAt: 0,
            stageEnteredAt: 0,
          });
        });
      }

      setRows(terminalRows);
      setTermsLoading(false);

      // Fire all scrapers immediately in the background
      for (const scraper of scrapers) {
        scraper
          .action()
          .then((result) => {
            scraperResults.current[scraper.id] = result;
          })
          .catch((err) => {
            scraperResults.current[scraper.id] = {
              jobsFound: 0,
              jobsNew: 0,
              error: err instanceof Error ? err.message : "Unknown error",
            };
          });
      }

      // Reveal only the first row — subsequent rows are revealed when the previous finishes typing
      setRows((prev) =>
        prev.map((r, idx) =>
          idx === 0 ? { ...r, phase: "typing", appearedAt: Date.now() } : r,
        ),
      );
    }

    init();
  }, []);

  // Typewriter ticker — advances typed chars for all "typing" rows
  useEffect(() => {
    const interval = setInterval(() => {
      setRows((prev) => {
        let changed = false;
        let revealNext = false;
        const next = prev.map((row) => {
          if (row.phase !== "typing") return row;
          const fullText = getSearchText(row.scraperName, row.termQuery);
          if (row.typedChars >= fullText.length) {
            // Done typing → move to waiting, and flag to reveal the next hidden row
            changed = true;
            revealNext = true;
            return { ...row, phase: "waiting" as const };
          }
          changed = true;
          return { ...row, typedChars: row.typedChars + 1 };
        });
        if (!changed) return prev;
        // If a row just finished typing, reveal the next hidden row
        if (revealNext) {
          const firstHidden = next.findIndex((r) => r.phase === "hidden");
          if (firstHidden !== -1) {
            next[firstHidden] = {
              ...next[firstHidden],
              phase: "typing",
              appearedAt: Date.now(),
            };
          }
        }
        return next;
      });
    }, TYPE_SPEED_MS);

    return () => clearInterval(interval);
  }, []);

  // Transition watcher — moves "waiting" rows to processing/done when results arrive
  // Enforces minimum 5s in the searching phase before transitioning
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setRows((prev) => {
        let changed = false;
        const next = prev.map((row) => {
          if (row.phase !== "waiting") return row;
          const result = scraperResults.current[row.scraperId];
          if (!result) return row; // real scraper hasn't finished yet
          // Enforce minimum search duration (5s from when row first appeared)
          if (now - row.appearedAt < MIN_SEARCH_MS) return row;
          changed = true;
          // Errors skip processing entirely
          if (result.error) {
            return { ...row, phase: "done" as const, result };
          }
          // Success/warning → start processing stages
          return {
            ...row,
            phase: "processing" as const,
            processingStage: 0,
            result,
            stageEnteredAt: now,
          };
        });
        return changed ? next : prev;
      });
    }, 200);

    return () => clearInterval(interval);
  }, []);

  // Processing stage ticker — advances each sub-stage after it's been visible for 2s
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setRows((prev) => {
        let changed = false;
        const next = prev.map((row) => {
          if (row.phase !== "processing") return row;
          // Wait until this stage has been visible for the minimum duration
          if (now - row.stageEnteredAt < PROCESSING_STAGE_MS) return row;
          if (row.processingStage >= 3) {
            // All 4 stages done → show result
            changed = true;
            return { ...row, phase: "done" as const };
          }
          changed = true;
          return {
            ...row,
            processingStage: row.processingStage + 1,
            stageEnteredAt: now,
          };
        });
        return changed ? next : prev;
      });
    }, 200);

    return () => clearInterval(interval);
  }, []);

  // Check if all visible rows are done
  const visibleRows = rows.filter((r) => r.phase !== "hidden");
  const allDone = rows.length > 0 && rows.every((r) => r.phase === "done");

  // Total new jobs (deduplicated per scraper, not per row)
  const seenScrapers = new Set<string>();
  const totalNew = rows.reduce((sum, r) => {
    if (r.result && !r.result.error && !seenScrapers.has(r.scraperId)) {
      seenScrapers.add(r.scraperId);
      return sum + r.result.jobsNew;
    }
    return sum;
  }, 0);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Searching Jobs</h2>
          <button onClick={onClose} className="btn-ghost" aria-label="Close">
            <XIcon size={24} weight="bold" />
          </button>
        </div>

        <div className="terminal-body" ref={terminalRef}>
          {termsLoading && (
            <div className="terminal-row">
              <UseAnimations
                animation={loading}
                size={14}
                loop
                autoplay
                strokeColor="var(--color-highlight-text)"
              />
              <span className="terminal-row-text">Loading search terms...</span>
            </div>
          )}
          {!termsLoading && rows.length === 0 && (
            <span className="terminal-row-text">
              No search terms configured.
            </span>
          )}
          {visibleRows.map((row) => (
            <TerminalRowLine key={row.id} row={row} />
          ))}
        </div>

        {allDone && (
          <div className="modal-footer">
            <span className="terminal-footer">
              {totalNew} new job{totalNew !== 1 ? "s" : ""} imported
            </span>
            <button onClick={onClose} className="btn btn-primary">
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Row rendering ---

function TerminalRowLine({ row }: { row: TerminalRow }) {
  const text = getRowDisplayText(row);
  const isTyping = row.phase === "typing";
  const isDone = row.phase === "done";

  // Pick the right icon — Lottie animations for in-progress, Phosphor fill icons for done
  const ICON_SIZE = 14;
  // Map processing stages to their corresponding Lottie animations
  const processingAnimations = [refresh, maximizeMinimize, filter, edit];

  let icon: React.ReactNode;
  if (isDone && row.result) {
    if (row.result.error) {
      icon = (
        <WarningOctagonIcon
          size={ICON_SIZE}
          weight="fill"
          className="terminal-icon-error"
        />
      );
    } else if (row.result.warnings && row.result.warnings.length > 0) {
      icon = (
        <WarningIcon
          size={ICON_SIZE}
          weight="fill"
          className="terminal-icon-warning"
        />
      );
    } else {
      icon = (
        <CheckCircleIcon
          size={ICON_SIZE}
          weight="fill"
          className="terminal-icon-success"
        />
      );
    }
  } else if (row.phase === "processing") {
    // Each processing stage gets its own animation
    const anim = processingAnimations[row.processingStage] ?? refresh;
    icon = (
      <UseAnimations
        key={`${row.id}-stage-${row.processingStage}`}
        animation={anim}
        size={ICON_SIZE}
        loop
        autoplay
        strokeColor="var(--color-highlight-text)"
      />
    );
  } else {
    // typing / waiting — circular loading animation
    icon = (
      <UseAnimations
        key={`${row.id}-searching`}
        animation={loading}
        size={ICON_SIZE}
        loop
        autoplay
        strokeColor="var(--color-highlight-text)"
      />
    );
  }

  // Pick text color class
  let textClass = "terminal-row-text";
  if (isDone && row.result) {
    if (row.result.error)
      textClass = "terminal-row-text terminal-row-text--error";
    else if (row.result.warnings && row.result.warnings.length > 0)
      textClass = "terminal-row-text terminal-row-text--warning";
    else textClass = "terminal-row-text terminal-row-text--success";
  }

  return (
    <div className="terminal-row">
      {icon}
      <span className={textClass}>
        {text}
        {isTyping && <span className="terminal-cursor" />}
      </span>
    </div>
  );
}
