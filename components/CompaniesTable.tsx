"use client";

import { useState, useTransition, useEffect, useCallback } from "react";
import { updateCompanyScores, deleteCompany } from "@/app/actions";
import {
  TrashIcon,
  CopySimpleIcon,
  DownloadSimpleIcon,
  CheckCircleIcon,
} from "@phosphor-icons/react";
import { generateCompanyPrompt } from "@/lib/exportPrompt";
import ImportScoresModal from "./ImportScoresModal";

type CompanyRow = {
  id: string;
  name: string;
  jobCount: number;
  activeJobCount: number; // jobs in backlog or in-progress statuses
  jobUrl: string | null;
  employeeSatisfaction: number | null;
  customerSatisfaction: number | null;
  workLifeBalance: number | null;
  politicalAlignment: number | null;
  benefits: number | null;
  note: string | null; // scoring rationale from Claude
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

// Auto-dismissing toast notification
function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 2000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div className="toast">
      <CheckCircleIcon size={20} weight="duotone" />
      <span>{message}</span>
    </div>
  );
}

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
  const [filter, setFilter] = useState(false); // filter to companies with missing scores
  const [filterWithJobs, setFilterWithJobs] = useState(false); // filter to companies with at least 1 job
  const [filterActive, setFilterActive] = useState(false); // filter to companies with backlog/in-progress jobs
  const [showImport, setShowImport] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const dismissToast = useCallback(() => setToastMsg(null), []);

  // Are there any companies with missing scores?
  const hasExportable = companies.some((c) =>
    SCORE_FIELDS.some((f) => c[f.key] === null),
  );

  function handleCopyPrompt() {
    // Copy the scoring prompt to clipboard instead of downloading a file
    const prompt = generateCompanyPrompt(displayed);
    if (!prompt) return;
    navigator.clipboard.writeText(prompt).then(() => setToastMsg("Copied to clipboard"));
  }

  // AND both filters together — each checkbox narrows the list independently
  const displayed = companies.filter((c) => {
    if (filter && !SCORE_FIELDS.some((f) => c[f.key] === null)) return false;
    if (filterWithJobs && c.jobCount === 0) return false;
    if (filterActive && c.activeJobCount === 0) return false;
    return true;
  });

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
    <div className="px-4 py-8">
      <div className="flex items-baseline gap-3 mb-4">
        <h1 className="page-title">Companies</h1>
        <span className="count-text">
          {displayed.length} {displayed.length === 1 ? "company" : "companies"}
          {(filter || filterWithJobs || filterActive) && ` (${companies.length} total)`}
        </span>
        {isPending && <span className="status-text">Saving...</span>}
      </div>

      <div className="flex items-center justify-end gap-3 mb-6">
        <label className="flex items-center gap-2 text-muted">
          <input
            type="checkbox"
            checked={filterWithJobs}
            onChange={(e) => setFilterWithJobs(e.target.checked)}
            className="checkbox"
          />
          Has jobs
        </label>
        <label className="flex items-center gap-2 text-muted">
          <input
            type="checkbox"
            checked={filterActive}
            onChange={(e) => setFilterActive(e.target.checked)}
            className="checkbox"
          />
          Active jobs
        </label>
        <label className="flex items-center gap-2 text-muted">
          <input
            type="checkbox"
            checked={filter}
            onChange={(e) => setFilter(e.target.checked)}
            className="checkbox"
          />
          Missing scores
        </label>
        <div className="divider-v" />
        <button
          onClick={handleCopyPrompt}
          disabled={!hasExportable}
          className="btn btn-ghost"
          title="Copy scoring prompt"
        >
          <CopySimpleIcon size={20} weight="bold" />
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
                <td className="font-medium" title={company.note ?? undefined}>{company.name}</td>
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
                  {filter || filterWithJobs || filterActive
                    ? "No companies match the current filters"
                    : "No companies yet — scrape some jobs first"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showImport && <ImportScoresModal onClose={() => setShowImport(false)} />}
      {toastMsg && <Toast message={toastMsg} onDismiss={dismissToast} />}
    </div>
  );
}
