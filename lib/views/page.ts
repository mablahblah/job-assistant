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
      ${jobTableView(backlog, "backlog", now)}
    </div>
    <div data-panel="active" style="display: none;">
      ${jobTableView(active, "active", now)}
    </div>
    <div data-panel="disqualified" style="display: none;">
      ${jobTableView(disqualified, "disqualified", now)}
    </div>
    <div data-panel="work-log" style="display: none;">
      ${workLogView(workLog, now)}
    </div>
  </div>

  <script src="/scripts/dashboard.js"></script>
</body>
</html>`;
}
