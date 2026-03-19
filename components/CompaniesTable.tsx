"use client";

import { useState, useTransition } from "react";
import { updateCompanyScores, deleteCompany } from "@/app/actions";
import {
  TrashIcon,
  ExportIcon,
  DownloadSimpleIcon,
} from "@phosphor-icons/react";
import { generateCompanyPrompt } from "@/lib/exportPrompt";
import ImportScoresModal from "./ImportScoresModal";

type CompanyRow = {
  id: string;
  name: string;
  jobCount: number;
  jobUrl: string | null;
  employeeSatisfaction: number | null;
  customerSatisfaction: number | null;
  workLifeBalance: number | null;
  politicalAlignment: number | null;
  benefits: number | null;
};

const SCORE_FIELDS = [
  {
    key: "employeeSatisfaction" as const,
    label: "ES",
    title: "Employee Satisfaction",
  },
  {
    key: "customerSatisfaction" as const,
    label: "CS",
    title: "Customer Satisfaction",
  },
  { key: "workLifeBalance" as const, label: "W/L", title: "Work/Life Balance" },
  {
    key: "politicalAlignment" as const,
    label: "PA",
    title: "Political Alignment",
  },
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
      onChange={(e) =>
        onChange(e.target.value === "" ? null : Number(e.target.value))
      }
      disabled={disabled}
      className="select w-14"
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

export default function CompaniesTable({
  companies,
}: {
  companies: CompanyRow[];
}) {
  const [isPending, startTransition] = useTransition();
  const [filter, setFilter] = useState(false);
  const [showImport, setShowImport] = useState(false);

  // Are there any companies with missing scores?
  const hasExportable = companies.some((c) =>
    SCORE_FIELDS.some((f) => c[f.key] === null),
  );

  function handleExport() {
    const prompt = generateCompanyPrompt(companies);
    if (!prompt) return;
    const blob = new Blob([prompt], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "company-scores-prompt.md";
    a.click();
    URL.revokeObjectURL(url);
  }

  const displayed = filter
    ? companies.filter((c) => SCORE_FIELDS.some((f) => c[f.key] === null))
    : companies;

  function handleScoreChange(
    company: CompanyRow,
    key: ScoreKey,
    val: number | null,
  ) {
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
        <h1 className="page-title">Companies</h1>
        <div className="flex items-center gap-3">
          {isPending && <span className="status-text">Saving...</span>}
          <label className="flex items-center gap-2 text-muted">
            <input
              type="checkbox"
              checked={filter}
              onChange={(e) => setFilter(e.target.checked)}
              className="checkbox"
            />
            Missing scores only
          </label>
          <div className="divider-v" />
          <button
            onClick={handleExport}
            disabled={!hasExportable}
            className="btn btn-ghost"
            title="Export scoring prompt"
          >
            <ExportIcon size={20} weight="bold" />
          </button>
          <button
            onClick={() => setShowImport(true)}
            disabled={!hasExportable}
            className="btn btn-ghost"
            title="Import scores from Claude"
          >
            <DownloadSimpleIcon size={20} weight="bold" />
          </button>
        </div>
      </div>

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th className="text-left">Company</th>
              <th className="text-center">Jobs</th>
              {SCORE_FIELDS.map((f) => (
                <th key={f.key} className="text-center" title={f.title}>
                  {f.label}
                </th>
              ))}
              <th className="text-center w-12"></th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((company) => (
              <tr key={company.id}>
                <td className="font-medium">{company.name}</td>
                <td className="text-center text-muted">{company.jobCount}</td>
                {SCORE_FIELDS.map((f) => (
                  <td key={f.key} className="text-center">
                    <ScoreDropdown
                      value={company[f.key]}
                      onChange={(val) => handleScoreChange(company, f.key, val)}
                      disabled={isPending}
                    />
                  </td>
                ))}
                <td className="text-center">
                  <button
                    onClick={() => handleDelete(company.id)}
                    disabled={isPending}
                    className="btn btn-ghost"
                    aria-label={`Delete ${company.name}`}
                    title="Delete company"
                  >
                    <TrashIcon size={16} />
                  </button>
                </td>
              </tr>
            ))}
            {displayed.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="text-center text-faint"
                  style={{ padding: "2rem 0.75rem" }}
                >
                  {filter
                    ? "All companies have scores"
                    : "No companies yet — scrape some jobs first"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="count-text">
        {displayed.length} {displayed.length === 1 ? "company" : "companies"}
        {filter && ` (${companies.length} total)`}
      </p>

      {showImport && <ImportScoresModal onClose={() => setShowImport(false)} />}
    </div>
  );
}
