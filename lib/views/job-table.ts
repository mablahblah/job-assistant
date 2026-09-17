// The table behind all three job lists on the dashboard. One list of column
// definitions builds both the headings and every row, so a column cannot be
// added to one and forgotten in the other.
import type { JobRow } from "../types/job-row";
import { escapeHtml } from "../utils/escape-html";
import { relativeDate } from "../utils/relative-date";
import { isReadablePeriod } from "../utils/salary-periods";
import { averageRating, ratingBand, scoreBand } from "../utils/score-display";
import { scoreReasoning } from "../utils/score-reasoning";
import { scoreTotal } from "../utils/score-total";

export type JobListName = "backlog" | "active" | "disqualified";

// Each list says it is empty in its own words, and none of them reads like a
// failure. "Nothing here" and "something broke" are different answers.
const EMPTY_MESSAGES: Record<JobListName, string> = {
  backlog: "No jobs in backlog.",
  active: "No active applications.",
  disqualified: "No jobs have been disqualified.",
};

// A column's heading and the cell it builds live together. Nothing else checks
// that the two lists stay the same length.
interface Column {
  heading: string;
  cell(row: JobRow, now: Date): string;
}

const WORK_MODES = ["remote", "hybrid", "in-person"] as const;

type WorkMode = (typeof WORK_MODES)[number];

const MODE_ICONS: Record<WorkMode | "none", { icon: string; label: string }> = {
  remote: { icon: "ph-wifi-high", label: "Remote" },
  hybrid: { icon: "ph-car-profile", label: "Hybrid" },
  "in-person": { icon: "ph-building-office", label: "In-Office" },
  none: { icon: "ph-question", label: "Unknown" },
};

// The stored employer name first, then the name the collector wrote onto the
// job, then a dash. A job company association never matched still has to name
// somebody, and the collected name is the only name it has.
function employerName(row: JobRow): string {
  return row.company?.name || row.job.raw_company_name || "—";
}

// The matched place is only filled once a job has been classified, and the
// ruled-out list is full of jobs the pipeline could not follow or read, which
// never got that far. Those fall back to what was collected instead of showing
// nothing for a reason that has nothing to do with the job.
function placeText(row: JobRow): string {
  const { location_match_place, normalized_location_list, raw_location_list } = row.job;
  if (location_match_place) return location_match_place;
  if (normalized_location_list?.length) return normalized_location_list.join(", ");
  if (raw_location_list?.length) return raw_location_list.join(", ");
  return "";
}

// The matched way of working falls back for the same reason the place does.
// Remote leads the order because it is the one that makes a distant job
// workable at all.
function workMode(row: JobRow): WorkMode | "none" {
  const matched = row.job.location_match_mode;
  if (matched && (WORK_MODES as readonly string[]).includes(matched)) return matched as WorkMode;

  const collected = row.job.normalized_mode_list ?? [];
  return WORK_MODES.find((mode) => collected.includes(mode)) ?? "none";
}

// A period the pipeline cannot read is evidence the figures are not yearly, so
// the column says it does not know rather than printing a number under a
// period it had to guess at.
function payText(row: JobRow): string {
  const { salary_low, salary_high, salary_period } = row.job;
  if (salary_low == null && salary_high == null) return "?";
  if (!isReadablePeriod(salary_period)) return "?";

  const period = escapeHtml(salary_period);
  const asMoney = (figure: number): string => `$${figure.toLocaleString("en-US")}`;

  if (salary_low != null && salary_high != null) {
    return `${asMoney(salary_low)}&ndash;${asMoney(salary_high)} / ${period}`;
  }
  return `${asMoney(salary_low ?? (salary_high as number))} / ${period}`;
}

function ratingText(value: number | null | undefined): string {
  if (value == null) return `<span class="score-none">?</span>`;
  return `<span class="${ratingBand(value)}">${value}</span>`;
}

function ratingColumn(label: string, read: (row: JobRow) => number | null | undefined): Column {
  return {
    heading: `<th class="col-rating col-rating-individual text-center">${label}</th>`,
    cell: (row) => `<td class="col-rating-individual text-center">${ratingText(read(row))}</td>`,
  };
}

// The total leads the backlog, where the question is still whether to apply.
// Once a job has been applied for or ruled out that question is answered, so
// the status leads those two instead. The five ratings stay on every list,
// because they still say what kind of job and employer it was.
const TOTAL_COLUMN: Column = {
  heading: `<th class="col-score">Score</th>`,
  cell: (row, now) => {
    const reasoning = scoreReasoning(row);
    const tooltip = reasoning === null ? "" : ` title="${escapeHtml(reasoning)}"`;
    const total = scoreTotal(row, now);
    return `<td${tooltip}><span class="${scoreBand(total)}">${total}</span></td>`;
  },
};

const STATUS_COLUMN: Column = {
  heading: `<th class="col-status text-center">Status</th>`,
  cell: (row) =>
    `<td class="col-status"><span class="status-badge">${escapeHtml(row.job.status)}</span></td>`,
};

const ROLE_COLUMN: Column = {
  heading: `<th>Role</th>`,
  cell: (row) => {
    // The followed address is the source posting; the found address is often
    // an aggregator's redirect, so it is only the fallback.
    const link = escapeHtml(row.job.resolved_url || row.job.original_url || "");
    return `<td><div class="company-role-cell"><span class="company-name">${escapeHtml(employerName(row))}</span><a href="${link}" target="_blank" rel="noopener noreferrer" class="link">${escapeHtml(row.job.title)}</a></div></td>`;
  },
};

const TYPE_COLUMN: Column = {
  heading: `<th>Type</th>`,
  cell: (row) => {
    const { icon, label } = MODE_ICONS[workMode(row)];
    const place = escapeHtml(placeText(row));
    const tooltip = place ? ` title="${place}"` : "";
    return `<td class="work-mode"${tooltip}><i class="ph-bold ${icon}" title="${escapeHtml(label)}"></i></td>`;
  },
};

const PLACE_COLUMN: Column = {
  heading: `<th class="col-hide-xl">Location</th>`,
  cell: (row) => `<td class="col-hide-xl text-muted">${escapeHtml(placeText(row))}</td>`,
};

const POSTED_COLUMN: Column = {
  heading: `<th class="col-posted">Posted</th>`,
  cell: (row, now) => {
    const { posting_date, posting_updated_date, is_repost } = row.job;
    const posted = posting_date ? relativeDate(posting_date, now) : "";
    // Classification only calls a job a repost where both dates exist, so a
    // true value guarantees the mark has a date to name.
    const mark =
      is_repost && posting_updated_date
        ? ` <span class="repost-pill" title="Reposted ${relativeDate(posting_updated_date, now)}">RP</span>`
        : "";
    return `<td class="col-posted"><div class="posted-cell"><span class="text-faint">${posted}</span>${mark}</div></td>`;
  },
};

const PAY_COLUMN: Column = {
  heading: `<th class="col-hide-phone">Salary</th>`,
  cell: (row) => `<td class="text-muted col-hide-phone">${payText(row)}</td>`,
};

// The narrow screen hides the five rating columns and shows this one instead,
// so its tooltip carries the five numbers it stands in for.
const AVERAGE_COLUMN: Column = {
  heading: `<th class="col-rating col-avg-rating text-center">Avg</th>`,
  cell: (row) => {
    const ratings = [
      row.job.alignment_score ?? null,
      row.company?.employee_satisfaction ?? null,
      row.company?.customer_satisfaction ?? null,
      row.company?.work_life_balance ?? null,
      row.company?.political_alignment ?? null,
    ];
    const [ja, es, cs, wl, pa] = ratings;
    const tooltip = `JA: ${ja ?? "?"} · ES: ${es ?? "?"} · CS: ${cs ?? "?"} · W/L: ${wl ?? "?"} · PA: ${pa ?? "?"}`;
    return `<td class="col-avg-rating text-center" title="${escapeHtml(tooltip)}">${ratingText(averageRating(ratings))}</td>`;
  },
};

function columnsFor(list: JobListName): Column[] {
  return [
    list === "backlog" ? TOTAL_COLUMN : STATUS_COLUMN,
    ROLE_COLUMN,
    TYPE_COLUMN,
    PLACE_COLUMN,
    POSTED_COLUMN,
    PAY_COLUMN,
    ratingColumn("Job<br>Align.", (row) => row.job.alignment_score),
    ratingColumn("Employee<br>Sat.", (row) => row.company?.employee_satisfaction),
    ratingColumn("Customer<br>Sat.", (row) => row.company?.customer_satisfaction),
    ratingColumn("Work /<br>Life", (row) => row.company?.work_life_balance),
    ratingColumn("Political<br>Align.", (row) => row.company?.political_alignment),
    AVERAGE_COLUMN,
  ];
}

// A job never changed sorts last rather than first, so an empty column cannot
// jump the queue.
function lastChanged(row: JobRow): number {
  return row.job.modified_at ? row.job.modified_at.getTime() : -Infinity;
}

// The backlog is a shortlist to work down, so the strongest total leads it.
// The other two are a record of what has happened, so what changed last leads
// them.
function sortRows(rows: JobRow[], list: JobListName, now: Date): JobRow[] {
  if (list === "backlog") {
    return [...rows].sort((a, b) => scoreTotal(b, now) - scoreTotal(a, now));
  }
  return [...rows].sort((a, b) => lastChanged(b) - lastChanged(a));
}

export function jobTableView(rows: JobRow[], list: JobListName, now: Date = new Date()): string {
  if (rows.length === 0) return `<p class="empty-state">${EMPTY_MESSAGES[list]}</p>`;

  const columns = columnsFor(list);
  const headings = columns.map((column) => column.heading).join("\n      ");
  const body = sortRows(rows, list, now)
    .map((row) => `<tr>\n  ${columns.map((column) => column.cell(row, now)).join("\n  ")}\n</tr>`)
    .join("\n");

  return `<div class="table-container">
<table class="table">
  <thead>
    <tr>
      ${headings}
    </tr>
  </thead>
  <tbody>
    ${body}
  </tbody>
</table>
</div>`;
}
