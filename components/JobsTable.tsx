"use client";

import { useTransition, useState } from "react";
import {
  toggleJobStatus,
  runScrape,
  deleteAllJobs,
  addSearchTerm,
  removeSearchTerm,
} from "@/app/actions";
import { JobWithCompany, SearchTerm } from "@/lib/types";
import { MagnifyingGlassIcon, PlusIcon, XIcon, TrashIcon } from "@phosphor-icons/react";

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
  const cls =
    value >= 4 ? "score-good" : value >= 3 ? "score-ok" : "score-bad";
  return <span className={cls}>{value}</span>;
}

function WorkModeBadge({ mode }: { mode: string }) {
  return <span className="work-mode-badge">{mode}</span>;
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

  function handleToggle(id: string) {
    startTransition(() => toggleJobStatus(id));
  }

  function handleScrape() {
    setScrapeStatus("Searching...");
    startTransition(async () => {
      try {
        const result = await runScrape();
        setScrapeStatus(
          `Done — ${result.jobsNew} new of ${result.jobsFound} found`,
        );
      } catch (err) {
        setScrapeStatus(
          `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
        );
      }
    });
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
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-4">
        <h1 className="page-title">Job Assistant</h1>
        {(scrapeStatus || (isPending && !scrapeStatus)) && (
          <span className="status-text">
            {scrapeStatus ?? "Saving..."}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-6">
        {hasTerms ? (
          <button
            onClick={handleScrape}
            disabled={isPending}
            className="btn btn-primary"
          >
            <MagnifyingGlassIcon size={14} weight="bold" />
            {isPending && scrapeStatus === "Searching..."
              ? "Searching..."
              : "Search Jobs"}
          </button>
        ) : (
          <button
            onClick={handleDeleteAll}
            disabled={isPending}
            className="btn btn-danger"
          >
            <TrashIcon size={14} weight="bold" />
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
            <PlusIcon size={14} weight="bold" />
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
              <XIcon size={12} weight="bold" />
            </button>
          </span>
        ))}
      </div>

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th className="col-score text-left">Score</th>
              <th className="col-status text-center">Status</th>
              <th className="text-left">Company</th>
              <th className="text-left">Role</th>
              <th className="text-left">Location</th>
              <th className="text-left">Posted</th>
              <th className="text-left">Salary</th>
              <th className="col-rating text-center">Employee<br />Satisfaction</th>
              <th className="col-rating text-center">Customer<br />Satisfaction</th>
              <th className="col-rating text-center">Work / Life<br />Balance</th>
              <th className="col-rating text-center">Political<br />Alignment</th>
              <th className="col-rating text-center">Benefits</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id}>
                <td>
                  <ScoreCell score={job.score} />
                </td>
                <td className="text-center">
                  <input
                    type="checkbox"
                    checked={job.status === "applied"}
                    onChange={() => handleToggle(job.id)}
                    disabled={isPending}
                    className="checkbox"
                  />
                </td>
                <td className="font-medium">{job.company.name}</td>
                <td>
                  <a
                    href={job.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="link"
                  >
                    {job.title}
                  </a>
                </td>
                <td>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-muted">{job.location}</span>
                    <WorkModeBadge mode={job.workMode} />
                  </div>
                </td>
                <td>
                  <RelativeDate date={job.postedAt} />
                </td>
                <td className="text-muted">{job.salaryRange}</td>
                <td className="text-center">
                  <RatingCell value={job.company.employeeSatisfaction} />
                </td>
                <td className="text-center">
                  <RatingCell value={job.company.customerSatisfaction} />
                </td>
                <td className="text-center">
                  <RatingCell value={job.company.workLifeBalance} />
                </td>
                <td className="text-center">
                  <RatingCell value={job.company.politicalAlignment} />
                </td>
                <td className="text-center">
                  <RatingCell value={job.company.benefits} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="count-text">{jobs.length} jobs</p>
    </div>
  );
}
