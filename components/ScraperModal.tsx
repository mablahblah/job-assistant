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
  runGreenhouseCompanyScrape,
  runLeverCompanyScrape,
} from "@/app/scraper-actions";
import { GREENHOUSE_SLUGS, LEVER_SLUGS } from "@/lib/scrapers/company-slugs";

type ScraperStatus = "idle" | "searching" | "success" | "warning" | "error";

interface ScraperRowState {
  id: string;
  name: string;
  status: ScraperStatus;
  jobsFound: number;
  jobsNew: number;
  error?: string;
  warnings?: string[];
  // Company-based scrapers
  currentCompany?: string;
  companyIndex?: number;
  companyTotal?: number;
  companyErrors?: string[];
}

const INITIAL_SCRAPERS: ScraperRowState[] = [
  { id: "adzuna", name: "Adzuna", status: "idle", jobsFound: 0, jobsNew: 0 },
  { id: "jsearch", name: "JSearch", status: "idle", jobsFound: 0, jobsNew: 0 },
  {
    id: "greenhouse",
    name: "Greenhouse",
    status: "idle",
    jobsFound: 0,
    jobsNew: 0,
    companyIndex: 0,
    companyTotal: GREENHOUSE_SLUGS.length,
  },
  {
    id: "lever",
    name: "Lever",
    status: "idle",
    jobsFound: 0,
    jobsNew: 0,
    companyIndex: 0,
    companyTotal: LEVER_SLUGS.length,
  },
  { id: "dribbble", name: "Dribbble", status: "idle", jobsFound: 0, jobsNew: 0 },
  {
    id: "weloveproduct",
    name: "We Love Product",
    status: "idle",
    jobsFound: 0,
    jobsNew: 0,
  },
];

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

    // Company-based scrapers: cycle through slugs, track per-company failures
    async function runCompanyScraper(
      id: string,
      slugs: string[],
      action: (slug: string) => Promise<{ jobsFound: number; jobsNew: number; error?: string }>
    ) {
      updateScraper(id, { status: "searching", companyIndex: 0 });
      let totalFound = 0;
      let totalNew = 0;
      const companyErrors: string[] = [];

      for (let i = 0; i < slugs.length; i++) {
        const slug = slugs[i];
        const displayName = slug.charAt(0).toUpperCase() + slug.slice(1);
        updateScraper(id, { currentCompany: displayName, companyIndex: i + 1 });

        try {
          const result = await action(slug);
          if (result.error) {
            // Server returned an error (e.g. no search terms) — applies to all companies
            updateScraper(id, { status: "error", error: result.error, currentCompany: undefined });
            return;
          }
          totalFound += result.jobsFound;
          totalNew += result.jobsNew;
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          companyErrors.push(`${displayName}: ${msg}`);
        }
      }

      const hasErrors = companyErrors.length > 0;
      updateScraper(id, {
        status: hasErrors && totalFound === 0 ? "error" : hasErrors ? "warning" : "success",
        jobsFound: totalFound,
        jobsNew: totalNew,
        currentCompany: undefined,
        companyErrors: hasErrors ? companyErrors : undefined,
        error: hasErrors && totalFound === 0 ? `All companies failed` : undefined,
      });
    }

    runSimpleScraper("adzuna", runAdzunaScrape);
    runSimpleScraper("jsearch", runJSearchScrape);
    runSimpleScraper("dribbble", runDribbbleScrape);
    runSimpleScraper("weloveproduct", runWeLoveProductScrape);
    runCompanyScraper("greenhouse", GREENHOUSE_SLUGS, runGreenhouseCompanyScrape);
    runCompanyScraper("lever", LEVER_SLUGS, runLeverCompanyScrape);
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
  const hasDetails =
    (scraper.warnings && scraper.warnings.length > 0) ||
    (scraper.companyErrors && scraper.companyErrors.length > 0);

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
          {scraper.companyErrors?.map((e, i) => (
            <div key={i} className="scraper-detail-line">{e}</div>
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
    if (scraper.companyTotal && scraper.currentCompany) {
      return (
        <span className="scraper-status-text">
          ({scraper.companyIndex}/{scraper.companyTotal}) Searching {scraper.currentCompany}...
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
