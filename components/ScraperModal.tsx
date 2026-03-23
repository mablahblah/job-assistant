"use client";

import { useEffect, useRef, useState } from "react";
import {
  XIcon,
  SpinnerIcon,
  CheckCircleIcon,
  WarningIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import {
  runAdzunaScrape,
  runJSearchScrape,
  runDribbbleScrape,
  runWeLoveProductScrape,
  runGreenhouseAllScrape,
  runLeverAllScrape,
} from "@/app/scraper-actions";
import { SCRAPER_CONFIG } from "@/lib/scrapers/scraper-config";

type ScraperStatus = "idle" | "searching" | "success" | "warning" | "error";

interface ScraperRowState {
  id: string;
  name: string;
  status: ScraperStatus;
  jobsFound: number;
  jobsNew: number;
  error?: string;
  warnings?: string[];
  // Company-based scrapers — total shown during "searching" state
  companyTotal?: number;
}

// Only include enabled scrapers — disabled ones are silently skipped
const INITIAL_SCRAPERS: ScraperRowState[] = [
  SCRAPER_CONFIG.adzuna.enabled && { id: "adzuna", name: "Adzuna", status: "idle" as const, jobsFound: 0, jobsNew: 0 },
  SCRAPER_CONFIG.jsearch.enabled && { id: "jsearch", name: "JSearch", status: "idle" as const, jobsFound: 0, jobsNew: 0 },
  SCRAPER_CONFIG.greenhouse.enabled && {
    id: "greenhouse",
    name: "Greenhouse",
    status: "idle" as const,
    jobsFound: 0,
    jobsNew: 0,
    companyTotal: SCRAPER_CONFIG.greenhouse.slugs.length,
  },
  SCRAPER_CONFIG.lever.enabled && {
    id: "lever",
    name: "Lever",
    status: "idle" as const,
    jobsFound: 0,
    jobsNew: 0,
    companyTotal: SCRAPER_CONFIG.lever.slugs.length,
  },
  SCRAPER_CONFIG.dribbble.enabled && { id: "dribbble", name: "Dribbble", status: "idle" as const, jobsFound: 0, jobsNew: 0 },
  SCRAPER_CONFIG.weloveproduct.enabled && { id: "weloveproduct", name: "We Love Product", status: "idle" as const, jobsFound: 0, jobsNew: 0 },
].filter(Boolean) as ScraperRowState[];

export default function ScraperModal({ onClose }: { onClose: () => void }) {
  const [scrapers, setScrapers] = useState<ScraperRowState[]>(INITIAL_SCRAPERS);
  const started = useRef(false);

  function updateScraper(id: string, update: Partial<ScraperRowState>) {
    setScrapers((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...update } : s))
    );
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    // Search-term-based scrapers
    async function runSimpleScraper(
      id: string,
      action: () => Promise<{ jobsFound: number; jobsNew: number; error?: string; warnings?: string[] }>
    ) {
      updateScraper(id, { status: "searching" });
      try {
        const result = await action();
        if (result.error) {
          updateScraper(id, { status: "error", error: result.error });
        } else if (result.warnings && result.warnings.length > 0) {
          updateScraper(id, {
            status: "warning",
            jobsFound: result.jobsFound,
            jobsNew: result.jobsNew,
            warnings: result.warnings,
          });
        } else {
          updateScraper(id, {
            status: "success",
            jobsFound: result.jobsFound,
            jobsNew: result.jobsNew,
          });
        }
      } catch (err) {
        updateScraper(id, {
          status: "error",
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    if (SCRAPER_CONFIG.adzuna.enabled) runSimpleScraper("adzuna", runAdzunaScrape);
    if (SCRAPER_CONFIG.jsearch.enabled) runSimpleScraper("jsearch", runJSearchScrape);
    if (SCRAPER_CONFIG.dribbble.enabled) runSimpleScraper("dribbble", runDribbbleScrape);
    if (SCRAPER_CONFIG.weloveproduct.enabled) runSimpleScraper("weloveproduct", runWeLoveProductScrape);
    // Greenhouse + Lever now run all companies in parallel server-side
    if (SCRAPER_CONFIG.greenhouse.enabled) runSimpleScraper("greenhouse", runGreenhouseAllScrape);
    if (SCRAPER_CONFIG.lever.enabled) runSimpleScraper("lever", runLeverAllScrape);
  }, []);

  const allDone = scrapers.every(
    (s) => s.status === "success" || s.status === "error" || s.status === "warning"
  );
  const totalNew = scrapers.reduce((sum, s) => sum + s.jobsNew, 0);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Searching Jobs</h2>
          <button onClick={onClose} className="btn-ghost" aria-label="Close">
            <XIcon size={24} weight="bold" />
          </button>
        </div>

        <div className="scraper-list">
          {scrapers.map((scraper) => (
            <ScraperRow key={scraper.id} scraper={scraper} />
          ))}
        </div>

        {allDone && (
          <div className="modal-footer">
            <span className="text-muted">
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

function ScraperRow({ scraper }: { scraper: ScraperRowState }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = scraper.warnings && scraper.warnings.length > 0;

  return (
    <div>
      <div className="scraper-row">
        <div className="scraper-row-left">
          <StatusIcon status={scraper.status} />
          <span className={`scraper-name ${scraper.status === "idle" ? "scraper-name-idle" : ""}`}>
            {scraper.name}
          </span>
        </div>
        <div className="scraper-row-right">
          <ScraperStatusText scraper={scraper} onToggleDetails={hasDetails ? () => setExpanded(!expanded) : undefined} />
        </div>
      </div>
      {expanded && hasDetails && (
        <div className="scraper-details">
          {scraper.warnings?.map((w, i) => (
            <div key={i} className="scraper-detail-line">{w}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: ScraperStatus }) {
  if (status === "idle") return <span className="scraper-icon scraper-icon-idle" />;
  if (status === "searching")
    return <SpinnerIcon size={18} weight="bold" className="scraper-icon scraper-spinner" />;
  if (status === "success")
    return <CheckCircleIcon size={18} weight="bold" className="scraper-icon scraper-icon-success" />;
  if (status === "warning")
    return <WarningIcon size={18} weight="bold" className="scraper-icon scraper-icon-warning" />;
  return <WarningCircleIcon size={18} weight="bold" className="scraper-icon scraper-icon-error" />;
}

function ScraperStatusText({
  scraper,
  onToggleDetails,
}: {
  scraper: ScraperRowState;
  onToggleDetails?: () => void;
}) {
  if (scraper.status === "idle") return null;

  if (scraper.status === "searching") {
    // Company-based scrapers show how many companies are being searched in parallel
    if (scraper.companyTotal) {
      return (
        <span className="scraper-status-text">
          Searching {scraper.companyTotal} companies...
        </span>
      );
    }
    return <span className="scraper-status-text">Searching...</span>;
  }

  if (scraper.status === "success") {
    return (
      <span className="scraper-status-text scraper-success-text">
        {scraper.jobsNew} new of {scraper.jobsFound} found
      </span>
    );
  }

  if (scraper.status === "warning") {
    return (
      <button onClick={onToggleDetails} className="scraper-status-btn scraper-warning-text">
        {scraper.jobsNew} new of {scraper.jobsFound} found (partial)
      </button>
    );
  }

  // Error
  return (
    <span className="scraper-status-text scraper-error-text">
      {scraper.error || "Failed"}
    </span>
  );
}
