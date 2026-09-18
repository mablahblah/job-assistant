// The work log page: a sidebar of benefit weeks, and the activities filed in
// the chosen week beside it. Read-only — the form itself is filled in on the
// Texas Workforce Commission's own site, and this page is what it is copied
// from.
import type { WorkLogRow } from "../types/work-log-row";
import { escapeHtml } from "../utils/escape-html";
import { groupByWeek, weekLabel, weekList } from "../utils/work-log-weeks";

// The only wording the form accepts in this field, and the only value the old
// database ever held in it.
const RESULT = "Application filed";

// The date, the employer name and the job title are read off the entry, never
// off the job or the employer it names. A filing is a record of what was true
// when it was made, so a later rename must not change it.
function entryView(row: WorkLogRow): string {
  const { entry, company } = row;
  const dateLabel = entry.created_at.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  // The details can be missing in two ways that read alike here: the job the
  // entry names has since been deleted, or it was never linked to an employer
  // at all. Either way they were not found, and the user has to go and find
  // them rather than assume the field is blank.
  let contactDetails: string;
  if (!company || (!company.address && !company.phone && !company.website)) {
    contactDetails = `<div class="work-log-enrichment-placeholder">Company info not found</div>`;
  } else {
    let fields = "";
    if (company.address) {
      fields += `<span class="work-log-entry-label">Address</span>
      <span class="work-log-field-secondary">${escapeHtml(company.address)}</span>`;
    }
    if (company.phone) {
      fields += `<span class="work-log-entry-label">Area Code + Phone #</span>
      <span class="work-log-field-secondary">${escapeHtml(company.phone)}</span>`;
    }
    if (company.website) {
      fields += `<span class="work-log-entry-label">Website</span>
      <a href="${escapeHtml(company.website)}" target="_blank" rel="noopener noreferrer" class="work-log-field-link">${escapeHtml(company.website)}</a>`;
    }
    contactDetails = fields;
  }

  return `<div class="work-log-entry">
  <div class="work-log-entry-grid">
    <div class="work-log-entry-col">
      <span class="work-log-entry-label">Date of Activity</span>
      <span class="work-log-field-primary">${dateLabel}</span>
      <span class="work-log-entry-label">Work Search Activity</span>
      <span class="work-log-field-secondary">${escapeHtml(entry.activity)}</span>
      <span class="work-log-entry-label">Type of Job</span>
      <span class="work-log-field-secondary">${escapeHtml(entry.job_title)}</span>
    </div>
    <div class="work-log-entry-col">
      <span class="work-log-entry-label">Name</span>
      <span class="work-log-field-primary">${escapeHtml(entry.company_name)}</span>
      ${contactDetails}
    </div>
    <div class="work-log-entry-col">
      <span class="work-log-entry-label">Results</span>
      <span class="work-log-field-primary">${RESULT}</span>
    </div>
  </div>
</div>`;
}

export function workLogView(rows: WorkLogRow[], now: Date = new Date()): string {
  if (rows.length === 0) {
    return `<p class="empty-state">No work search entries yet. Apply to jobs to start logging.</p>`;
  }

  const filed = groupByWeek(rows);

  // Every week from the first filing to today, not only the weeks holding
  // entries. A week nothing was filed in is the one that still owes
  // activities, so it is the one most worth seeing.
  const oldest = rows.reduce(
    (earliest, row) => (row.entry.created_at < earliest ? row.entry.created_at : earliest),
    rows[0].entry.created_at
  );
  const weeks = weekList(oldest, now);

  const sidebar = weeks
    .map((week, position) => {
      const key = week.toISOString();
      const opened = position === 0 ? " work-log-sidebar-item--active" : "";
      return `<button class="work-log-sidebar-item${opened}" data-week="${key}">
      <span class="work-log-sidebar-item-label">${weekLabel(week)}</span>
    </button>`;
    })
    .join("\n");

  const sections = weeks
    .map((week, position) => {
      const key = week.toISOString();
      const held = filed.get(key) ?? [];
      const hidden = position > 0 ? " is-hidden" : "";
      const entries =
        held.length === 0
          ? `<p class="work-log-empty">No activities this week.</p>`
          : `<div class="work-log-entries">${held.map(entryView).join("\n")}</div>`;

      return `<section class="work-log-week-section${hidden}" data-week-content="${key}">
      <div class="work-log-week-header">
        <h2 class="work-log-week-title">${weekLabel(week)}</h2>
      </div>
      ${entries}
    </section>`;
    })
    .join("\n");

  return `<div class="work-log-layout">
  <aside class="work-log-sidebar">
    <div class="work-log-sidebar-inner">
      <p class="work-log-sidebar-label">Weeks</p>
      ${sidebar}
    </div>
  </aside>
  <div class="work-log-main">
    ${sections}
  </div>
</div>`;
}
