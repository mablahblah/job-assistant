"use client";

import { useTransition, useState } from "react";
import {
  setJobStatus,
  deleteAllJobs,
  addSearchTerm,
  removeSearchTerm,
} from "@/app/actions";
import { JobWithCompany, SearchTerm } from "@/lib/types";
import {
  MagnifyingGlassIcon,
  PlusIcon,
  XIcon,
  TrashIcon,
  WifiHighIcon,
  BicycleIcon,
  BuildingOfficeIcon,
  FunnelIcon,
} from "@phosphor-icons/react";
import ScraperModal from "@/components/ScraperModal";
import StatusDropdown from "@/components/StatusDropdown";

function ScoreCell({ score }: { score: number }) {
  const cls =
    score >= 70 ? "score-good" : score >= 40 ? "score-ok" : "score-bad";
  return <span className={cls}>{score}</span>;
}

function RelativeDate({ date }: { date: string }) {
  const days = Math.floor(
    (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24),
  );
  const label = days === 0 ? "Today" : days === 1 ? "1d ago" : `${days}d ago`;
  return <span className="text-faint">{label}</span>;
}

function RatingCell({ value }: { value: number | null }) {
  if (value === null) return <span className="score-none">?</span>;
  const cls = value >= 4 ? "score-good" : value >= 3 ? "score-ok" : "score-bad";
  return <span className={cls}>{value}</span>;
}

// Averages up to 5 company scores, shows tooltip with individual breakdown
function AvgRatingCell({ company }: { company: { employeeSatisfaction: number | null; customerSatisfaction: number | null; workLifeBalance: number | null; politicalAlignment: number | null; benefits: number | null } }) {
  const scores = [company.employeeSatisfaction, company.customerSatisfaction, company.workLifeBalance, company.politicalAlignment, company.benefits];
  const valid = scores.filter((s): s is number => s !== null);
  const avg = valid.length > 0 ? Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 10) / 10 : null;
  const tooltip = `ES: ${company.employeeSatisfaction ?? "?"} · CS: ${company.customerSatisfaction ?? "?"} · W/L: ${company.workLifeBalance ?? "?"} · PA: ${company.politicalAlignment ?? "?"} · Ben: ${company.benefits ?? "?"}`;

  if (avg === null) return <span className="score-none" title={tooltip}>?</span>;
  const cls = avg >= 4 ? "score-good" : avg >= 3 ? "score-ok" : "score-bad";
  return <span className={cls} title={tooltip}>{avg}</span>;
}


function WorkModeIcon({ mode }: { mode: string }) {
  if (mode === "remote") return <WifiHighIcon size={24} weight="regular" />;
  if (mode === "hybrid") return <BicycleIcon size={24} weight="regular" />;
  return <BuildingOfficeIcon size={24} weight="regular" />;
}

export default function JobsTable({
  jobs,
  searchTerms,
}: {
  jobs: JobWithCompany[];
  searchTerms: SearchTerm[];
}) {
  const [isPending, startTransition] = useTransition();
  const [scrapeStatus, setScrapeStatus] = useState<string | null>(null);
  const [newTerm, setNewTerm] = useState("");
  const [showScraperModal, setShowScraperModal] = useState(false);
  // Filter is on by default — hides out-of-area and stale postings
  const [filterEnabled, setFilterEnabled] = useState(true);

  // Austin metro cities we're willing to commute to
  const AUSTIN_AREA = ["austin", "round rock", "cedar park", "pflugerville"];

  // Returns true if a job should be hidden when filtering is on
  function isFilteredOut(job: JobWithCompany): boolean {
    // Hide posts older than 10 days — they're probably filled or stale
    const ageDays = (Date.now() - new Date(job.postedAt).getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > 10) return true;
    // Hide non-remote jobs outside the Austin metro area (unknown mode treated as in-person)
    if (job.workMode !== "remote") {
      const loc = (job.location ?? "").toLowerCase();
      if (!AUSTIN_AREA.some((city) => loc.includes(city))) return true;
    }
    return false;
  }

  const displayedJobs = filterEnabled ? jobs.filter((job) => !isFilteredOut(job)) : jobs;

  function handleSetStatus(id: string, status: string) {
    startTransition(() => setJobStatus(id, status));
  }

  function handleScrape() {
    setShowScraperModal(true);
  }

  function handleDeleteAll() {
    if (!confirm("Delete all jobs, companies, and scraping history?")) return;
    setScrapeStatus(null);
    startTransition(() => deleteAllJobs());
  }

  function handleAddTerm() {
    if (!newTerm.trim()) return;
    startTransition(() => addSearchTerm(newTerm.trim()));
    setNewTerm("");
  }

  function handleRemoveTerm(id: string) {
    startTransition(() => removeSearchTerm(id));
  }

  const hasTerms = searchTerms.length > 0;

  return (
    <div className="px-4 py-8">
      <div className="flex items-baseline gap-3 mb-4">
        <h1 className="page-title">Job Assistant</h1>
        <span className="count-text">
          {displayedJobs.length} jobs
          {filterEnabled && displayedJobs.length !== jobs.length && ` (${jobs.length} total)`}
        </span>
        {(scrapeStatus || (isPending && !scrapeStatus)) && (
          <span className="status-text">{scrapeStatus ?? "Saving..."}</span>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
        <div className="flex flex-wrap items-center gap-2">
        {hasTerms ? (
          <button
            onClick={handleScrape}
            disabled={isPending}
            className="btn btn-primary"
          >
            <MagnifyingGlassIcon size={14} weight="regular" />
            Search Jobs
          </button>
        ) : (
          <button
            onClick={handleDeleteAll}
            disabled={isPending}
            className="btn btn-danger"
          >
            <TrashIcon size={14} weight="regular" />
            Delete All
          </button>
        )}
        <div className="divider-v" />
        <div className="relative flex items-center">
          <input
            type="text"
            value={newTerm}
            onChange={(e) => setNewTerm(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddTerm()}
            placeholder="Add job title..."
            className="input pr-8 w-44"
          />
          <button
            onClick={handleAddTerm}
            disabled={isPending || !newTerm.trim()}
            className="btn-icon btn-icon-primary absolute right-[3px]"
            aria-label="Add job title"
          >
            <PlusIcon size={14} weight="regular" />
          </button>
        </div>
        {searchTerms.map((term) => (
          <span key={term.id} className="badge">
            {term.query}
            <button
              onClick={() => handleRemoveTerm(term.id)}
              disabled={isPending}
              className="badge-remove"
              aria-label={`Remove ${term.query}`}
            >
              <XIcon size={12} weight="regular" />
            </button>
          </span>
        ))}
        </div>
        <button
          onClick={() => setFilterEnabled(!filterEnabled)}
          className={`btn btn-ghost ${filterEnabled ? "btn-ghost-active" : ""}`}
          title={filterEnabled ? "Smart filter on — click to show all" : "Smart filter off — click to filter"}
        >
          <FunnelIcon size={20} weight={filterEnabled ? "duotone" : "bold"} />
        </button>
      </div>

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th className="col-score text-left">Score</th>
              <th className="col-status text-center">Status</th>
              <th className="text-left">Role</th>
              <th className="text-left">Location</th>
              <th className="text-left col-hide-phone">Posted</th>
              <th className="text-left col-hide-phone">Salary</th>
              <th className="col-rating col-rating-individual text-center">
                Employee
                <br />
                Satisfaction
              </th>
              <th className="col-rating col-rating-individual text-center">
                Customer
                <br />
                Satisfaction
              </th>
              <th className="col-rating col-rating-individual text-center">
                Work / Life
                <br />
                Balance
              </th>
              <th className="col-rating col-rating-individual text-center">
                Political
                <br />
                Alignment
              </th>
              <th className="col-rating col-rating-individual text-center">Benefits</th>
              <th className="col-rating col-avg-rating text-center">Avg.<br />Score</th>
            </tr>
          </thead>
          <tbody>
            {displayedJobs.map((job) => (
              <tr key={job.id}>
                <td>
                  <ScoreCell score={job.score} />
                </td>
                <td className="text-center">
                  <StatusDropdown
                    status={job.status}
                    disabled={isPending}
                    onSelect={(s) => handleSetStatus(job.id, s)}
                  />
                </td>
                <td>
                  <div className="company-role-cell">
                    <span className="company-name">{job.company.name}</span>
                    <a
                      href={job.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="link"
                    >
                      {job.title}
                    </a>
                  </div>
                </td>
                <td>
                  <div className="flex items-center gap-1.5" title={job.location ?? ""}>
                    <WorkModeIcon mode={job.workMode} />
                    <span className="text-muted location-text">{job.location}</span>
                  </div>
                </td>
                <td className="col-hide-phone">
                  <RelativeDate date={job.postedAt} />
                </td>
                <td className="text-muted col-hide-phone">{job.salaryRange}</td>
                <td className="col-rating-individual text-center">
                  <RatingCell value={job.company.employeeSatisfaction} />
                </td>
                <td className="col-rating-individual text-center">
                  <RatingCell value={job.company.customerSatisfaction} />
                </td>
                <td className="col-rating-individual text-center">
                  <RatingCell value={job.company.workLifeBalance} />
                </td>
                <td className="col-rating-individual text-center">
                  <RatingCell value={job.company.politicalAlignment} />
                </td>
                <td className="col-rating-individual text-center">
                  <RatingCell value={job.company.benefits} />
                </td>
                <td className="col-avg-rating text-center">
                  <AvgRatingCell company={job.company} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showScraperModal && (
        <ScraperModal onClose={() => setShowScraperModal(false)} />
      )}
    </div>
  );
}
