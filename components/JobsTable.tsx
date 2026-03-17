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

function ScoreCell({ score }: { score: number }) {
  const color =
    score >= 70
      ? "text-green-600 font-semibold"
      : score >= 40
        ? "text-yellow-600 font-semibold"
        : "text-red-600 font-semibold";
  return <span className={color}>{score}</span>;
}

function RelativeDate({ date }: { date: string }) {
  const days = Math.floor(
    (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24),
  );
  const label = days === 0 ? "Today" : days === 1 ? "1d ago" : `${days}d ago`;
  return <span className="text-gray-500 text-sm">{label}</span>;
}

function RatingCell({ value }: { value: number }) {
  const color =
    value >= 4
      ? "text-green-600"
      : value >= 3
        ? "text-yellow-600"
        : "text-red-600";
  return <span className={`${color} text-sm`}>{value}</span>;
}

function WorkModeBadge({ mode }: { mode: string }) {
  const styles: Record<string, string> = {
    remote: "bg-green-100 text-green-700",
    hybrid: "bg-yellow-100 text-yellow-700",
    "in-person": "bg-gray-100 text-gray-700",
  };
  return (
    <span
      className={`text-xs px-1.5 py-0.5 rounded ${styles[mode] ?? "bg-gray-100 text-gray-700"}`}
    >
      {mode}
    </span>
  );
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
        <h1 className="text-2xl font-bold">Job Assistant</h1>
        {(scrapeStatus || (isPending && !scrapeStatus)) && (
          <span className="text-sm text-gray-500">
            {scrapeStatus ?? "Saving..."}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-6">
        {hasTerms ? (
          <button
            onClick={handleScrape}
            disabled={isPending}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 shrink-0"
          >
            {isPending && scrapeStatus === "Searching..."
              ? "Searching..."
              : "Search Jobs"}
          </button>
        ) : (
          <button
            onClick={handleDeleteAll}
            disabled={isPending}
            className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 shrink-0"
          >
            Delete All
          </button>
        )}
        <div className="w-px h-6 bg-gray-300 shrink-0" />
        <div className="relative flex items-center">
          <input
            type="text"
            value={newTerm}
            onChange={(e) => setNewTerm(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddTerm()}
            placeholder="Add job title..."
            className="text-sm border border-gray-300 rounded pl-3 pr-8 py-1.5 w-44 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            onClick={handleAddTerm}
            disabled={isPending || !newTerm.trim()}
            className="absolute right-[3px] w-6 h-6 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-30 leading-none flex items-center justify-center"
            aria-label="Add job title"
          >
            +
          </button>
        </div>
        {searchTerms.map((term) => (
          <span
            key={term.id}
            className="flex items-center gap-1 px-2.5 py-1 bg-blue-100 text-blue-800 text-sm rounded-full"
          >
            {term.query}
            <button
              onClick={() => handleRemoveTerm(term.id)}
              disabled={isPending}
              className="ml-0.5 text-blue-500 hover:text-blue-800 disabled:opacity-50 leading-none"
              aria-label={`Remove ${term.query}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-3 py-3 text-left font-medium text-gray-600">
                Score
              </th>
              <th className="px-3 py-3 text-center font-medium text-gray-600">
                Applied
              </th>
              <th className="px-3 py-3 text-left font-medium text-gray-600">
                Company
              </th>
              <th className="px-3 py-3 text-left font-medium text-gray-600">
                Role
              </th>
              <th className="px-3 py-3 text-left font-medium text-gray-600">
                Location
              </th>
              <th className="px-3 py-3 text-left font-medium text-gray-600">
                Age
              </th>
              <th className="px-3 py-3 text-left font-medium text-gray-600">
                Salary
              </th>
              <th className="px-3 py-3 text-center font-medium text-gray-600">
                ES
              </th>
              <th className="px-3 py-3 text-center font-medium text-gray-600">
                CS
              </th>
              <th className="px-3 py-3 text-center font-medium text-gray-600">
                W/L
              </th>
              <th className="px-3 py-3 text-center font-medium text-gray-600">
                PA
              </th>
              <th className="px-3 py-3 text-center font-medium text-gray-600">
                Ben
              </th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job, i) => (
              <tr
                key={job.id}
                className={`border-b border-gray-100 hover:bg-gray-50 ${
                  i % 2 === 0 ? "bg-white" : "bg-gray-50/50"
                }`}
              >
                <td className="px-3 py-3">
                  <ScoreCell score={job.score} />
                </td>
                <td className="px-3 py-3 text-center">
                  <input
                    type="checkbox"
                    checked={job.status === "applied"}
                    onChange={() => handleToggle(job.id)}
                    disabled={isPending}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                </td>
                <td className="px-3 py-3 font-medium">{job.company.name}</td>
                <td className="px-3 py-3">
                  <a
                    href={job.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    {job.title}
                  </a>
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-gray-700 text-sm">
                      {job.location}
                    </span>
                    <WorkModeBadge mode={job.workMode} />
                  </div>
                </td>
                <td className="px-3 py-3">
                  <RelativeDate date={job.postedAt} />
                </td>
                <td className="px-3 py-3 text-gray-700">{job.salaryRange}</td>
                <td className="px-3 py-3 text-center">
                  <RatingCell value={job.company.employeeSatisfaction} />
                </td>
                <td className="px-3 py-3 text-center">
                  <RatingCell value={job.company.customerSatisfaction} />
                </td>
                <td className="px-3 py-3 text-center">
                  <RatingCell value={job.company.workLifeBalance} />
                </td>
                <td className="px-3 py-3 text-center">
                  <RatingCell value={job.company.politicalAlignment} />
                </td>
                <td className="px-3 py-3 text-center">
                  <RatingCell value={job.benefits} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-sm text-gray-500">{jobs.length} jobs</p>
    </div>
  );
}
