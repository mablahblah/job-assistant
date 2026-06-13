import { describe, it, expect } from "vitest";
import { renderJobTable, renderWorkLog, renderPage } from "./render";
import { WebJob, WebWorkLogEntry, PageData } from "./types";

// ── Shared test fixtures ──

const mockJob: WebJob = {
  id: "test-1",
  score: 85,
  status: "backlog",
  title: "Senior Product Designer",
  url: "https://example.com/jobs/123",
  workMode: "remote",
  location: "San Francisco, CA",
  firstPublished: new Date("2026-04-18T00:00:00Z"),
  repostedAt: null,
  salaryRange: "$120k–$150k",
  jobAlignment: 4,
  modifiedAt: null,
  company: {
    name: "Acme Corp",
    note: "Great culture",
    employeeSatisfaction: 4,
    customerSatisfaction: 3,
    workLifeBalance: 5,
    politicalAlignment: 4,
  },
};

const mockRepostedJob: WebJob = {
  ...mockJob,
  id: "test-repost",
  repostedAt: new Date("2026-06-12T00:00:00Z"),
};

const mockEntry: WebWorkLogEntry = {
  id: "entry-1",
  date: "2026-04-09T00:00:00.000Z",
  activityType: "Applied for job",
  result: "Application filed",
  job: {
    title: "Senior Product Designer",
    company: {
      name: "Acme Corp",
      address: "123 Main St, Austin, TX",
      phone: "(512) 555-1234",
      website: "https://acme.com",
      enrichmentStatus: "complete",
    },
  },
};

const emptyData: PageData = {
  backlog: [],
  active: [],
  disqualified: [],
  workLogEntries: [],
  weekSlots: [],
};

// ── renderJobTable ──

describe("renderJobTable", () => {
  it("renders composite score with color class", () => {
    const html = renderJobTable([mockJob], "backlog");
    expect(html).toContain("score-ok"); // 85 is orange range
    expect(html).toContain(">85<");
  });

  it("renders clickable job title as a link", () => {
    const html = renderJobTable([mockJob], "backlog");
    expect(html).toContain('href="https://example.com/jobs/123"');
    expect(html).toContain("Senior Product Designer");
  });

  it("renders company name above job title", () => {
    const html = renderJobTable([mockJob], "backlog");
    expect(html).toContain("Acme Corp");
    expect(html).toContain("company-name");
  });

  it("hides Status column for backlog variant", () => {
    const html = renderJobTable([mockJob], "backlog");
    expect(html).not.toContain("col-status");
  });

  it("shows Status column with badge for active variant", () => {
    const activeJob = { ...mockJob, status: "app. sent" };
    const html = renderJobTable([activeJob], "active");
    expect(html).toContain("col-status");
    expect(html).toContain("status-badge");
    expect(html).toContain("app. sent");
  });

  it("shows Status column for disqualified variant", () => {
    const dqJob = { ...mockJob, status: "rejected" };
    const html = renderJobTable([dqJob], "disqualified");
    expect(html).toContain("col-status");
    expect(html).toContain("rejected");
  });

  it("renders individual category scores as plain numbers", () => {
    const html = renderJobTable([mockJob], "backlog");
    expect(html).toContain('class="score-good">4<');
    expect(html).toContain('class="score-ok">3<');
    expect(html).toContain('class="score-good">5<');
  });

  it("renders ? for null category scores", () => {
    const job = {
      ...mockJob,
      company: { ...mockJob.company, employeeSatisfaction: null },
    };
    const html = renderJobTable([job], "backlog");
    expect(html).toContain('class="score-none">?<');
  });

  it("renders avg score column for mobile rollup", () => {
    const html = renderJobTable([mockJob], "backlog");
    expect(html).toContain("col-avg-rating");
  });

  it("renders work mode icon and location as separate columns", () => {
    const html = renderJobTable([mockJob], "backlog");
    expect(html).toContain(">Type<");
    expect(html).toContain("col-hide-xl");
    expect(html).toContain("ph-wifi-high");
    expect(html).toContain('title="Remote"');
    expect(html).toContain("San Francisco, CA");
  });

  it("renders company note as tooltip on company name", () => {
    const html = renderJobTable([mockJob], "backlog");
    expect(html).toContain('title="Great culture"');
  });

  it("renders avg score tooltip with individual breakdown", () => {
    const html = renderJobTable([mockJob], "backlog");
    expect(html).toContain("JA: 4");
    expect(html).toContain("ES: 4");
  });

  it("renders job alignment as first score column", () => {
    const html = renderJobTable([mockJob], "backlog");
    const jaHeaderIndex = html.indexOf("Job<br>Align.");
    const esHeaderIndex = html.indexOf("Employee<br>Sat.");
    expect(jaHeaderIndex).toBeLessThan(esHeaderIndex);
  });

  it("renders salary range", () => {
    const html = renderJobTable([mockJob], "backlog");
    expect(html).toContain("$120k–$150k");
  });

  it("renders empty state when no jobs", () => {
    const html = renderJobTable([], "backlog");
    expect(html).toContain("No jobs in backlog");
  });

  it("renders RP pill with repost tooltip when repostedAt is set", () => {
    const html = renderJobTable([mockRepostedJob], "backlog");
    expect(html).toContain("repost-pill");
    expect(html).toContain(">RP<");
    expect(html).toContain('title="Reposted');
  });

  it("does not render RP pill when repostedAt is null", () => {
    const html = renderJobTable([mockJob], "backlog");
    expect(html).not.toContain("repost-pill");
  });

  it("escapes HTML in user content", () => {
    const xssJob = {
      ...mockJob,
      title: '<script>alert("xss")</script>',
      company: { ...mockJob.company, name: "Evil<Co" },
    };
    const html = renderJobTable([xssJob], "backlog");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

// ── renderWorkLog ──

describe("renderWorkLog", () => {
  it("renders empty state when no entries or weeks", () => {
    const html = renderWorkLog([], []);
    expect(html).toContain("No work search entries");
  });

  it("renders sidebar with week labels", () => {
    const week = new Date("2026-04-05T00:00:00.000Z");
    const html = renderWorkLog([mockEntry], [week]);
    expect(html).toContain("work-log-sidebar");
    expect(html).toContain("Apr 5");
  });

  it("renders entry with activity details", () => {
    const week = new Date("2026-04-05T00:00:00.000Z");
    const html = renderWorkLog([mockEntry], [week]);
    expect(html).toContain("Applied for job");
    expect(html).toContain("Application filed");
    expect(html).toContain("Senior Product Designer");
  });

  it("renders company info when enrichment is complete", () => {
    const week = new Date("2026-04-05T00:00:00.000Z");
    const html = renderWorkLog([mockEntry], [week]);
    expect(html).toContain("Acme Corp");
    expect(html).toContain("123 Main St, Austin, TX");
    expect(html).toContain("(512) 555-1234");
    expect(html).toContain("https://acme.com");
  });

  it("renders placeholder when enrichment failed", () => {
    const failedEntry: WebWorkLogEntry = {
      ...mockEntry,
      id: "entry-2",
      job: {
        ...mockEntry.job,
        company: {
          name: "NoData Inc",
          address: null,
          phone: null,
          website: null,
          enrichmentStatus: "failed",
        },
      },
    };
    const week = new Date("2026-04-05T00:00:00.000Z");
    const html = renderWorkLog([failedEntry], [week]);
    expect(html).toContain("Company info not found");
    expect(html).toContain("work-log-enrichment-placeholder");
  });

  it("renders placeholder when enrichment is pending", () => {
    const pendingEntry: WebWorkLogEntry = {
      ...mockEntry,
      id: "entry-3",
      job: {
        ...mockEntry.job,
        company: {
          name: "Pending Co",
          address: null,
          phone: null,
          website: null,
          enrichmentStatus: "pending",
        },
      },
    };
    const week = new Date("2026-04-05T00:00:00.000Z");
    const html = renderWorkLog([pendingEntry], [week]);
    expect(html).toContain("Company info pending");
    expect(html).toContain("work-log-enrichment-placeholder");
  });

  it("shows only the first week by default, hides others", () => {
    const week1 = new Date("2026-04-12T00:00:00.000Z");
    const week2 = new Date("2026-04-05T00:00:00.000Z");
    const html = renderWorkLog([mockEntry], [week1, week2]);
    expect(html).toContain('style="display: none;"');
  });

  it("marks the first sidebar week as active", () => {
    const week = new Date("2026-04-05T00:00:00.000Z");
    const html = renderWorkLog([mockEntry], [week]);
    expect(html).toContain("work-log-sidebar-item--active");
  });
});

// ── renderPage ──

describe("renderPage", () => {
  it("renders valid HTML document with doctype", () => {
    const html = renderPage(emptyData);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
  });

  it("does not include a page title heading", () => {
    const html = renderPage(emptyData);
    expect(html).not.toContain("<h1");
  });

  it("includes CSS link tag", () => {
    const html = renderPage(emptyData);
    expect(html).toContain("/styles/styles.css");
  });

  it("includes all four tab buttons", () => {
    const html = renderPage(emptyData);
    expect(html).toContain("Backlog");
    expect(html).toContain("Active Jobs");
    expect(html).toContain("Disqualified");
    expect(html).toContain("Work Log");
  });

  it("shows tab counts in parentheses", () => {
    const data: PageData = {
      ...emptyData,
      backlog: [mockJob],
      active: [
        { ...mockJob, id: "a1", status: "app. sent" },
        { ...mockJob, id: "a2", status: "interview" },
      ],
    };
    const html = renderPage(data);
    expect(html).toContain("(1)");
    expect(html).toContain("(2)");
    expect(html).toContain("(0)");
  });

  it("includes JS script tag", () => {
    const html = renderPage(emptyData);
    expect(html).toContain("/scripts/dashboard.js");
  });

  it("first tab panel is visible, others are hidden", () => {
    const html = renderPage(emptyData);
    expect(html).toContain('data-panel="backlog">');
    expect(html).toContain('data-panel="active" style="display: none;"');
    expect(html).toContain('data-panel="disqualified" style="display: none;"');
    expect(html).toContain('data-panel="work-log" style="display: none;"');
  });

  it("renders job data inside the backlog panel", () => {
    const data: PageData = { ...emptyData, backlog: [mockJob] };
    const html = renderPage(data);
    expect(html).toContain("Senior Product Designer");
    expect(html).toContain("Acme Corp");
  });
});
