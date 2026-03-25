"use client";

import { useTransition, useState, useMemo, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import {
  setJobStatus,
  deleteJob,
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
  FlagPennantIcon,
  TreeViewIcon,
  BatteryHighIcon,
  ReceiptXIcon,
} from "@phosphor-icons/react";
import ScraperModal from "@/components/ScraperModal";
import StatusDropdown from "@/components/StatusDropdown";
import ConfirmDialog from "@/components/ConfirmDialog";

// Which statuses belong to each tab
const TAB_STATUSES = {
  backlog: ["backlog"],
  "in-progress": ["app. sent", "screening", "interview", "test", "offer"],
  disqualified: ["expired", "too far", "rejected", "won't apply"],
} as const;

type TabKey = keyof typeof TAB_STATUSES;

// Sort order for In Progress tab — later stages first
const IN_PROGRESS_ORDER: Record<string, number> = {
  offer: 0,
  test: 1,
  interview: 2,
  screening: 3,
  "app. sent": 4,
};

// Tab metadata: label, icon, sort function
const TABS: { key: TabKey; label: string; icon: typeof TreeViewIcon }[] = [
  { key: "backlog", label: "Backlog", icon: TreeViewIcon },
  { key: "in-progress", label: "In Progress", icon: BatteryHighIcon },
  { key: "disqualified", label: "Disqualified", icon: ReceiptXIcon },
];

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
function AvgRatingCell({
  company,
}: {
  company: {
    employeeSatisfaction: number | null;
    customerSatisfaction: number | null;
    workLifeBalance: number | null;
    politicalAlignment: number | null;
    benefits: number | null;
  };
}) {
  const scores = [
    company.employeeSatisfaction,
    company.customerSatisfaction,
    company.workLifeBalance,
    company.politicalAlignment,
    company.benefits,
  ];
  const valid = scores.filter((s): s is number => s !== null);
  const avg =
    valid.length > 0
      ? Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 10) / 10
      : null;
  const tooltip = `ES: ${company.employeeSatisfaction ?? "?"} · CS: ${company.customerSatisfaction ?? "?"} · W/L: ${company.workLifeBalance ?? "?"} · PA: ${company.politicalAlignment ?? "?"} · Ben: ${company.benefits ?? "?"}`;

  if (avg === null)
    return (
      <span className="score-none" title={tooltip}>
        ?
      </span>
    );
  const cls = avg >= 4 ? "score-good" : avg >= 3 ? "score-ok" : "score-bad";
  return (
    <span className={cls} title={tooltip}>
      {avg}
    </span>
  );
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
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null); // job awaiting delete confirmation
  const searchParams = useSearchParams();

  // Track active tab in local state, seeded from URL on mount
  const [activeTab, setActiveTab] = useState<TabKey>(
    () => (searchParams.get("tab") as TabKey) || "backlog",
  );

  // Switch tab: update state + sync URL without triggering server navigation
  const switchTab = useCallback((tab: TabKey) => {
    setActiveTab(tab);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", tab);
    window.history.replaceState(null, "", `?${params.toString()}`);
  }, []);

  // Count jobs per tab (always uses full list, not filtered)
  const tabCounts = useMemo(() => {
    const counts: Record<TabKey, number> = {
      backlog: 0,
      "in-progress": 0,
      disqualified: 0,
    };
    for (const job of jobs) {
      for (const [tab, statuses] of Object.entries(TAB_STATUSES)) {
        if ((statuses as readonly string[]).includes(job.status)) {
          counts[tab as TabKey]++;
        }
      }
    }
    return counts;
  }, [jobs]);

  // Filter and sort jobs for the active tab
  const filteredJobs = useMemo(() => {
    const statuses = TAB_STATUSES[activeTab] as readonly string[];
    const filtered = jobs.filter((j) => statuses.includes(j.status));

    if (activeTab === "backlog") {
      return filtered.sort((a, b) => b.score - a.score);
    }
    if (activeTab === "in-progress") {
      return filtered.sort(
        (a, b) =>
          (IN_PROGRESS_ORDER[a.status] ?? 99) -
          (IN_PROGRESS_ORDER[b.status] ?? 99),
      );
    }
    // Disqualified: most recently modified first
    return filtered.sort((a, b) => {
      const aDate = a.modifiedAt ? new Date(a.modifiedAt).getTime() : 0;
      const bDate = b.modifiedAt ? new Date(b.modifiedAt).getTime() : 0;
      return bDate - aDate;
    });
  }, [jobs, activeTab]);

  function handleSetStatus(id: string, status: string) {
    startTransition(() => setJobStatus(id, status));
  }

  function handleScrape() {
    setShowScraperModal(true);
  }

  // Confirm then hard-delete a job and block its URL from future scrapes
  function handleConfirmDelete() {
    if (!deleteTarget) return;
    startTransition(() => deleteJob(deleteTarget.id));
    setDeleteTarget(null);
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
        {(scrapeStatus || (isPending && !scrapeStatus)) && (
          <span className="status-text">{scrapeStatus ?? "Saving..."}</span>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
        <div className="flex flex-wrap items-center gap-2">
          {hasTerms && (
            <button
              onClick={handleScrape}
              disabled={isPending}
              className="btn btn-primary"
            >
              <MagnifyingGlassIcon size={14} weight="regular" />
              Search Jobs
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
      </div>
      {/* Tab sub-nav — Backlog | In Progress | Disqualified */}
      <nav className="tab-nav mb-6">
        {TABS.map(({ key, label, icon: Icon }) => {
          const active = activeTab === key;
          return (
            <button
              key={key}
              className={`tab-nav-item ${active ? "tab-nav-item-active" : ""}`}
              onClick={() => switchTab(key)}
            >
              <Icon size={16} weight={active ? "duotone" : "regular"} />
              <span>{label}</span>
              <span className="tab-nav-count">({tabCounts[key]})</span>
            </button>
          );
        })}
      </nav>

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
              <th className="col-rating col-rating-individual text-center">
                Benefits
              </th>
              <th className="col-rating col-avg-rating text-center">
                Avg.
                <br />
                Score
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredJobs.map((job) => (
              <tr key={job.id}>
                <td>
                  <ScoreCell score={job.score} />
                </td>
                <td className="text-center">
                  <div className="flex items-center justify-center gap-1">
                    <StatusDropdown
                      status={job.status}
                      disabled={isPending}
                      onSelect={(s) => handleSetStatus(job.id, s)}
                    />
                    {/* Flag icon for jobs auto-set to "too far" with unrecognized remote location */}
                    {job.locationFlagged && (
                      <span
                        title={`workMode = ${job.workMode}; location = ${job.location}`}
                        style={{
                          display: "inline-flex",
                          color: "var(--color-negative-text)",
                          flexShrink: 0,
                        }}
                      >
                        <FlagPennantIcon size={24} weight="duotone" />
                      </span>
                    )}
                  </div>
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
                  <div
                    className="flex items-center gap-1.5"
                    title={job.location ?? ""}
                  >
                    <WorkModeIcon mode={job.workMode} />
                    <span className="text-muted location-text">
                      {job.location}
                    </span>
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
                <td>
                  {/* Delete action: icon + label on xl, icon-only with tooltip below */}
                  <button
                    className="delete-action"
                    title="Delete"
                    onClick={() => setDeleteTarget({ id: job.id, title: job.title })}
                  >
                    <TrashIcon size={18} weight="regular" />
                    <span className="delete-action-label">Delete</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showScraperModal && (
        <ScraperModal onClose={() => setShowScraperModal(false)} />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Are you sure?"
          body="This job won't appear again in future job searches."
          confirmLabel="Yes, Delete Job"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleConfirmDelete}
        />
      )}
    </div>
  );
}
