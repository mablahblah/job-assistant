"use client";

import { useState, useTransition } from "react";
import { updateCompanyScores, deleteCompany } from "@/app/actions";

type CompanyRow = {
  id: string;
  name: string;
  jobCount: number;
  employeeSatisfaction: number | null;
  customerSatisfaction: number | null;
  workLifeBalance: number | null;
  politicalAlignment: number | null;
  benefits: number | null;
};

const SCORE_FIELDS = [
  { key: "employeeSatisfaction" as const, label: "ES", title: "Employee Satisfaction" },
  { key: "customerSatisfaction" as const, label: "CS", title: "Customer Satisfaction" },
  { key: "workLifeBalance" as const, label: "W/L", title: "Work/Life Balance" },
  { key: "politicalAlignment" as const, label: "PA", title: "Political Alignment" },
  { key: "benefits" as const, label: "Ben", title: "Benefits" },
];

type ScoreKey = (typeof SCORE_FIELDS)[number]["key"];

function ScoreDropdown({
  value,
  onChange,
  disabled,
}: {
  value: number | null;
  onChange: (val: number | null) => void;
  disabled: boolean;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      disabled={disabled}
      className="w-14 text-sm border border-gray-300 rounded px-1 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
    >
      <option value="">?</option>
      {[1, 2, 3, 4, 5].map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  );
}

export default function CompaniesTable({ companies }: { companies: CompanyRow[] }) {
  const [isPending, startTransition] = useTransition();
  const [filter, setFilter] = useState(false);

  const displayed = filter
    ? companies.filter((c) =>
        SCORE_FIELDS.some((f) => c[f.key] === null)
      )
    : companies;

  function handleScoreChange(company: CompanyRow, key: ScoreKey, val: number | null) {
    const scores = {
      employeeSatisfaction: company.employeeSatisfaction,
      customerSatisfaction: company.customerSatisfaction,
      workLifeBalance: company.workLifeBalance,
      politicalAlignment: company.politicalAlignment,
      benefits: company.benefits,
      [key]: val,
    };
    startTransition(() => updateCompanyScores(company.id, scores));
  }

  function handleDelete(companyId: string) {
    if (!confirm("Delete this company and its jobs?")) return;
    startTransition(() => deleteCompany(companyId));
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Companies</h1>
        <div className="flex items-center gap-3">
          {isPending && (
            <span className="text-sm text-gray-500">Saving...</span>
          )}
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={filter}
              onChange={(e) => setFilter(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Missing scores only
          </label>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-3 py-3 text-left font-medium text-gray-600">Company</th>
              <th className="px-3 py-3 text-center font-medium text-gray-600">Jobs</th>
              {SCORE_FIELDS.map((f) => (
                <th key={f.key} className="px-3 py-3 text-center font-medium text-gray-600" title={f.title}>
                  {f.label}
                </th>
              ))}
              <th className="px-3 py-3 text-center font-medium text-gray-600 w-12"></th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((company, i) => (
              <tr
                key={company.id}
                className={`border-b border-gray-100 ${
                  i % 2 === 0 ? "bg-white" : "bg-gray-50/50"
                }`}
              >
                <td className="px-3 py-3 font-medium">{company.name}</td>
                <td className="px-3 py-3 text-center text-gray-500">{company.jobCount}</td>
                {SCORE_FIELDS.map((f) => (
                  <td key={f.key} className="px-3 py-3 text-center">
                    <ScoreDropdown
                      value={company[f.key]}
                      onChange={(val) => handleScoreChange(company, f.key, val)}
                      disabled={isPending}
                    />
                  </td>
                ))}
                <td className="px-3 py-3 text-center">
                  <button
                    onClick={() => handleDelete(company.id)}
                    disabled={isPending}
                    className="px-2 py-1 text-sm text-red-500 hover:text-red-700 disabled:opacity-50"
                    aria-label={`Delete ${company.name}`}
                    title="Delete company"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
            {displayed.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-gray-400">
                  {filter ? "All companies have scores" : "No companies yet — scrape some jobs first"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-sm text-gray-500">
        {displayed.length} {displayed.length === 1 ? "company" : "companies"}
        {filter && ` (${companies.length} total)`}
      </p>
    </div>
  );
}
