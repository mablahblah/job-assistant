// All HTML rendering for the web dashboard — job tables, work log, page shell

import { WebJob, WebWorkLogEntry, TableVariant, PageData } from "./types";
import {
  scoreColor,
  ratingColor,
  relativeDate,
  avgRating,
  escapeHtml,
} from "./helpers";
import {
  groupEntriesByWeek,
  formatWeekLabel,
} from "../work-search-weeks";

// ── Job Table ──

// Default empty-state messages per tab
const EMPTY_MESSAGES: Record<TableVariant, string> = {
  backlog: "No jobs in backlog.",
  active: "No active applications.",
  disqualified: "No jobs have been disqualified.",
};

// Returns a Phosphor bold icon for work mode with text label as tooltip
function workModeIcon(mode: string): string {
  const map: Record<string, { icon: string; label: string }> = {
    remote: { icon: "ph-wifi-high", label: "Remote" },
    hybrid: { icon: "ph-car-profile", label: "Hybrid" },
    "in-person": { icon: "ph-building-office", label: "In-Office" },
  };
  const { icon, label } = map[mode] ?? { icon: "ph-question", label: mode };
  return `<i class="ph-bold ${icon}" title="${escapeHtml(label)}"></i>`;
}

// Renders a single score/rating cell — number with color class, or "?" for null
function renderRating(value: number | null): string {
  if (value === null) return `<span class="score-none">?</span>`;
  return `<span class="${ratingColor(value)}">${value}</span>`;
}

// Renders one table row for a job
function renderJobRow(job: WebJob, variant: TableVariant): string {
  const name = escapeHtml(job.company.name);
  const title = escapeHtml(job.title);
  const url = escapeHtml(job.url);
  const location = escapeHtml(job.location);
  const salary = escapeHtml(job.salaryRange);
  const mode = workModeIcon(job.workMode);
  const posted = relativeDate(job.firstPublished);

  // RP pill — shown inline after the date when the job has been reposted
  const repostHtml = job.repostedAt
    ? ` <span class="repost-pill" title="Reposted ${relativeDate(job.repostedAt)}">RP</span>`
    : "";

  // Composite score cell
  const scoreHtml = `<span class="${scoreColor(job.score)}">${job.score}</span>`;

  // Status cell — only rendered for active and disqualified tabs
  const statusCell =
    variant !== "backlog"
      ? `<td class="col-status"><span class="status-badge">${escapeHtml(job.status)}</span></td>`
      : "";

  // Individual category score cells
  const es = renderRating(job.company.employeeSatisfaction);
  const cs = renderRating(job.company.customerSatisfaction);
  const wl = renderRating(job.company.workLifeBalance);
  const pa = renderRating(job.company.politicalAlignment);
  const ja = renderRating(job.jobAlignment);

  // Average of all 5 category scores — shown on tablet, hides individual columns
  const avg = avgRating([
    job.company.employeeSatisfaction,
    job.company.customerSatisfaction,
    job.company.workLifeBalance,
    job.company.politicalAlignment,
    job.jobAlignment,
  ]);
  const avgHtml =
    avg === null
      ? `<span class="score-none">?</span>`
      : `<span class="${ratingColor(avg)}">${avg}</span>`;

  // Company name tooltip shows scoring rationale (note field)
  const noteAttr = job.company.note
    ? ` title="${escapeHtml(job.company.note)}"`
    : "";

  // Avg score tooltip shows individual score breakdown for quick reference
  const avgTooltip = ` title="JA: ${job.jobAlignment ?? "?"} · ES: ${job.company.employeeSatisfaction ?? "?"} · CS: ${job.company.customerSatisfaction ?? "?"} · W/L: ${job.company.workLifeBalance ?? "?"} · PA: ${job.company.politicalAlignment ?? "?"}"`;

  return `<tr>
  <td>${scoreHtml}</td>
  ${statusCell}
  <td><div class="company-role-cell"><span class="company-name"${noteAttr}>${name}</span><a href="${url}" target="_blank" rel="noopener noreferrer" class="link">${title}</a></div></td>
  <td class="work-mode"${location ? ` title="${location}"` : ""}>${mode}</td>
  <td class="col-hide-xl text-muted">${location}</td>
  <td class="col-posted"><div class="posted-cell"><span class="text-faint">${posted}</span>${repostHtml}</div></td>
  <td class="text-muted col-hide-phone">${salary}</td>
  <td class="col-rating-individual text-center">${ja}</td>
  <td class="col-rating-individual text-center">${es}</td>
  <td class="col-rating-individual text-center">${cs}</td>
  <td class="col-rating-individual text-center">${wl}</td>
  <td class="col-rating-individual text-center">${pa}</td>
  <td class="col-avg-rating text-center"${avgTooltip}>${avgHtml}</td>
</tr>`;
}

// Renders the complete job table for a tab variant
export function renderJobTable(jobs: WebJob[], variant: TableVariant): string {
  if (jobs.length === 0) {
    return `<p class="empty-state">${EMPTY_MESSAGES[variant]}</p>`;
  }

  // Status header only appears for active and disqualified tabs
  const statusHeader =
    variant !== "backlog"
      ? `<th class="col-status text-center">Status</th>`
      : "";

  const rows = jobs.map((job) => renderJobRow(job, variant)).join("\n");

  return `<div class="table-container">
<table class="table">
  <thead>
    <tr>
      <th class="col-score">Score</th>
      ${statusHeader}
      <th>Role</th>
      <th>Type</th>
      <th class="col-hide-xl">Location</th>
      <th class="col-posted">Posted</th>
      <th class="col-hide-phone">Salary</th>
      <th class="col-rating col-rating-individual text-center">Job<br>Align.</th>
      <th class="col-rating col-rating-individual text-center">Employee<br>Sat.</th>
      <th class="col-rating col-rating-individual text-center">Customer<br>Sat.</th>
      <th class="col-rating col-rating-individual text-center">Work /<br>Life</th>
      <th class="col-rating col-rating-individual text-center">Political<br>Align.</th>
      <th class="col-rating col-avg-rating text-center">Avg</th>
    </tr>
  </thead>
  <tbody>
    ${rows}
  </tbody>
</table>
</div>`;
}

// ── Work Log ──

// Renders a single activity entry card with 3-column TWC layout
function renderEntry(entry: WebWorkLogEntry): string {
  const dateLabel = new Date(entry.date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const companyName = escapeHtml(entry.job.company.name);
  const jobTitle = escapeHtml(entry.job.title);
  const activity = escapeHtml(entry.activityType);
  const result = escapeHtml(entry.result);

  // Column 2: company contact info depends on enrichment status
  let companyInfoHtml: string;
  const co = entry.job.company;

  if (co.enrichmentStatus === "pending") {
    companyInfoHtml = `<div class="work-log-enrichment-placeholder">Company info pending...</div>`;
  } else if (
    co.enrichmentStatus === "failed" ||
    (!co.address && !co.phone && !co.website)
  ) {
    companyInfoHtml = `<div class="work-log-enrichment-placeholder">Company info not found</div>`;
  } else {
    let fields = "";
    if (co.address) {
      fields += `<span class="work-log-entry-label">Address</span>
      <span class="work-log-field-secondary">${escapeHtml(co.address)}</span>`;
    }
    if (co.phone) {
      fields += `<span class="work-log-entry-label">Area Code + Phone #</span>
      <span class="work-log-field-secondary">${escapeHtml(co.phone)}</span>`;
    }
    if (co.website) {
      fields += `<span class="work-log-entry-label">Website</span>
      <a href="${escapeHtml(co.website)}" target="_blank" rel="noopener noreferrer" class="work-log-field-link">${escapeHtml(co.website)}</a>`;
    }
    companyInfoHtml = fields;
  }

  return `<div class="work-log-entry">
  <div class="work-log-entry-grid">
    <div class="work-log-entry-col">
      <span class="work-log-entry-label">Date of Activity</span>
      <span class="work-log-field-primary">${dateLabel}</span>
      <span class="work-log-entry-label">Work Search Activity</span>
      <span class="work-log-field-secondary">${activity}</span>
      <span class="work-log-entry-label">Type of Job</span>
      <span class="work-log-field-secondary">${jobTitle}</span>
    </div>
    <div class="work-log-entry-col">
      <span class="work-log-entry-label">Name</span>
      <span class="work-log-field-primary">${companyName}</span>
      ${companyInfoHtml}
    </div>
    <div class="work-log-entry-col">
      <span class="work-log-entry-label">Results</span>
      <span class="work-log-field-primary">${result}</span>
    </div>
  </div>
</div>`;
}

// Renders the complete work log: sidebar navigation + week content sections
export function renderWorkLog(
  entries: WebWorkLogEntry[],
  weekSlots: Date[],
): string {
  // Empty state when there are no weeks to show
  if (weekSlots.length === 0) {
    return `<p class="empty-state">No work search entries yet. Apply to jobs to start logging.</p>`;
  }

  // Group entries by their week start date for fast lookup
  const entriesByWeek = groupEntriesByWeek(entries);

  // Sidebar: one clickable button per week
  const sidebarItems = weekSlots
    .map((week, i) => {
      const key = week.toISOString();
      const label = formatWeekLabel(week);
      const activeClass = i === 0 ? " work-log-sidebar-item--active" : "";
      return `<button class="work-log-sidebar-item${activeClass}" data-week="${key}">
      <span class="work-log-sidebar-item-label">${label}</span>
    </button>`;
    })
    .join("\n");

  // Week sections: only the first is visible; JS toggles the rest
  const weekSections = weekSlots
    .map((week, i) => {
      const key = week.toISOString();
      const label = formatWeekLabel(week);
      const weekEntries = entriesByWeek.get(key) ?? [];
      const hidden = i > 0 ? ' style="display: none;"' : "";

      const entriesHtml =
        weekEntries.length === 0
          ? `<p class="work-log-empty">No activities this week.</p>`
          : `<div class="work-log-entries">${weekEntries.map(renderEntry).join("\n")}</div>`;

      return `<section class="work-log-week-section" data-week-content="${key}"${hidden}>
      <div class="work-log-week-header">
        <h2 class="work-log-week-title">${label}</h2>
      </div>
      ${entriesHtml}
    </section>`;
    })
    .join("\n");

  return `<div class="work-log-layout">
  <aside class="work-log-sidebar">
    <div class="work-log-sidebar-inner">
      <p class="work-log-sidebar-label">Weeks</p>
      ${sidebarItems}
    </div>
  </aside>
  <div class="work-log-main">
    ${weekSections}
  </div>
</div>`;
}

// ── Page Shell ──

// Assembles the complete HTML document with tab nav and four panels
export function renderPage(data: PageData): string {
  const { backlog, active, disqualified, workLogEntries, weekSlots } = data;

  const tabs = [
    { id: "backlog", label: "Backlog", count: backlog.length },
    { id: "active", label: "Active Jobs", count: active.length },
    { id: "disqualified", label: "Disqualified", count: disqualified.length },
    { id: "work-log", label: "Work Log", count: null as number | null },
  ];

  // Tab buttons — first is active by default
  const tabButtons = tabs
    .map((tab, i) => {
      const activeClass = i === 0 ? " tab-nav-item-active" : "";
      const countHtml =
        tab.count !== null
          ? ` <span class="tab-nav-count">(${tab.count})</span>`
          : "";
      return `<button class="tab-nav-item${activeClass}" data-tab="${tab.id}">${tab.label}${countHtml}</button>`;
    })
    .join("\n    ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Job Assistant</title>
  <link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/bold/style.css">
  <link rel="stylesheet" href="/styles/styles.css">
</head>
<body>
  <div class="page-container">
    <nav class="tab-nav">
    ${tabButtons}
    </nav>

    <div data-panel="backlog">
      ${renderJobTable(backlog, "backlog")}
    </div>
    <div data-panel="active" style="display: none;">
      ${renderJobTable(active, "active")}
    </div>
    <div data-panel="disqualified" style="display: none;">
      ${renderJobTable(disqualified, "disqualified")}
    </div>
    <div data-panel="work-log" style="display: none;">
      ${renderWorkLog(workLogEntries, weekSlots)}
    </div>
  </div>

  <script src="/scripts/dashboard.js"></script>
</body>
</html>`;
}
