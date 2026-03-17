"use client";

import { useMemo, useRef, useState } from "react";
import { MOCK_COMPANIES, MOCK_JOBS } from "@/lib/mock-data";
import { calculateScore } from "@/lib/scoring";
import { JobWithCompany } from "@/lib/types";

function buildJobsWithScores(): JobWithCompany[] {
  const companyMap = new Map(MOCK_COMPANIES.map((c) => [c.id, c]));
  return MOCK_JOBS.map((job) => {
    const company = companyMap.get(job.companyId)!;
    return {
      ...job,
      company,
      score: calculateScore(job, company),
    };
  }).sort((a, b) => b.score - a.score);
}

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

export default function JobsTable() {
  const initialJobs = useMemo(() => buildJobsWithScores(), []);
  const [jobs, setJobs] = useState<JobWithCompany[]>(initialJobs);
  const savedState = useRef<Map<string, boolean>>(
    new Map(initialJobs.map((j) => [j.id, j.applied])),
  );
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const hasChanges = useMemo(
    () => jobs.some((j) => j.applied !== savedState.current.get(j.id)),
    [jobs],
  );

  function toggleApplied(id: string) {
    setJobs((prev) =>
      prev.map((j) => (j.id === id ? { ...j, applied: !j.applied } : j)),
    );
  }

  function handleSave() {
    const updated = new Map(jobs.map((j) => [j.id, j.applied]));
    savedState.current = updated;
    // Force re-render so hasChanges recomputes
    setJobs([...jobs]);
    setSaveMessage("Saved!");
    console.log(
      "[Save] Applied states:",
      Object.fromEntries(updated.entries()),
    );
    setTimeout(() => setSaveMessage(null), 2000);
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Job Assistant</h1>
        <div className="flex items-center gap-3">
          {saveMessage && (
            <span className="text-green-600 text-sm font-medium">
              {saveMessage}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={!hasChanges}
            className="px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Save
          </button>
        </div>
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
                    checked={job.applied}
                    onChange={() => toggleApplied(job.id)}
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
