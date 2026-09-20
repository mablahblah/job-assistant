// The whole dashboard in one document: the four lists and the switcher between
// them. Everything is built at once rather than fetched a list at a time,
// because the page is read-only and small, and one address answering where
// every job stands beats a round trip per tab.
import type { JobRow } from "../types/job-row";
import type { WorkLogRow } from "../types/work-log-row";
import { jobTableView } from "./job-table";
import { workLogView } from "./work-log";

export interface PageContents {
  backlog: JobRow[];
  active: JobRow[];
  disqualified: JobRow[];
  workLog: WorkLogRow[];
}

export function pageView(contents: PageContents, now?: Date): string {
  const { backlog, active, disqualified, workLog } = contents;

  // The work log carries no count, deliberately. It is filed a week at a time,
  // so one total across every week says nothing the user can act on.
  const tabs = [
    { id: "backlog", label: "Backlog", count: backlog.length },
    { id: "active", label: "Active Jobs", count: active.length },
    { id: "disqualified", label: "Disqualified", count: disqualified.length },
    { id: "work-log", label: "Work Log", count: null as number | null },
  ];

  const tabButtons = tabs
    .map((tab, position) => {
      const opened = position === 0 ? " tab-nav-item-active" : "";
      const count = tab.count === null ? "" : ` <span class="tab-nav-count">(${tab.count})</span>`;
      return `<button class="tab-nav-item${opened}" data-tab="${tab.id}">${tab.label}${count}</button>`;
    })
    .join("\n    ");

  // Counts hidden jobs too, so the user sees how much of the backlog is
  // unchecked whichever way the switch is set. The page always draws the
  // switch off, and the browser script restores a saved choice.
  const unjudgedCount = backlog.filter((row) => !row.job.is_judged).length;
  const unjudgedToggle = `<label class="unjudged-toggle" data-shows-on="backlog">
      <span>Hide Unjudged <span class="unjudged-toggle-count">(${unjudgedCount})</span></span>
      <input type="checkbox" role="switch" class="switch" data-unjudged-toggle>
    </label>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Job Assistant</title>
  <link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/bold/style.css">
  <link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css">
  <link rel="stylesheet" href="/styles/styles.css">
</head>
<body>
  <div class="page-container">
    <nav class="tab-nav">
    ${tabButtons}
    ${unjudgedToggle}
    </nav>

    <div data-panel="backlog">
      ${jobTableView(backlog, "backlog", now)}
    </div>
    <div data-panel="active" class="is-hidden">
      ${jobTableView(active, "active", now)}
    </div>
    <div data-panel="disqualified" class="is-hidden">
      ${jobTableView(disqualified, "disqualified", now)}
    </div>
    <div data-panel="work-log" class="is-hidden">
      ${workLogView(workLog, now)}
    </div>
  </div>

  <script src="/scripts/dashboard.js"></script>
</body>
</html>`;
}
