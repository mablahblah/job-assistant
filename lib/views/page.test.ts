import { describe, expect, test } from "vitest";
import type { JobRow } from "../types/job-row";
import type { WorkLogRow } from "../types/work-log-row";
import { pageView } from "./page";

const NOW = new Date(2026, 3, 20, 12);

function job(id: string, status: string): JobRow {
  return {
    job: {
      id,
      title: `Role ${id}`,
      status,
      original_url: `https://boards.example.com/${id}`,
      posting_date: new Date(2026, 3, 18, 12),
      modified_at: new Date(2026, 3, 18, 12),
    },
    company: null,
  };
}

function entry(): WorkLogRow {
  return {
    entry: {
      id: "entry-1",
      job_id: "job-1",
      company_name: "Acme",
      job_title: "Senior Product Designer",
      activity: "Applied for job",
      created_at: new Date(2026, 3, 20, 12),
    },
    company: null,
  };
}

function page(
  parts: Partial<{
    backlog: JobRow[];
    active: JobRow[];
    disqualified: JobRow[];
    workLog: WorkLogRow[];
  }> = {}
): string {
  return pageView(
    {
      backlog: parts.backlog ?? [],
      active: parts.active ?? [],
      disqualified: parts.disqualified ?? [],
      workLog: parts.workLog ?? [],
    },
    NOW
  );
}

// Criteria 103, 104, 105 and 106. One address answers where every job stands.
describe("the four lists", () => {
  test("the backlog is on the page", () => {
    expect(page({ backlog: [job("b1", "backlog")] })).toContain("Role b1");
  });

  test("the active list is on the page", () => {
    expect(page({ active: [job("a1", "app. sent")] })).toContain("Role a1");
  });

  test("the disqualified list is on the page", () => {
    expect(page({ disqualified: [job("d1", "unparseable")] })).toContain("Role d1");
  });

  test("the work log is on the page", () => {
    expect(page({ workLog: [entry()] })).toContain("Senior Product Designer");
  });

  test("each list sits in a panel of its own", () => {
    const html = page();

    for (const panel of ["backlog", "active", "disqualified", "work-log"]) {
      expect(html).toContain(`data-panel="${panel}"`);
    }
  });
});

// Criterion 107. The switcher is a script reading the page's own markup, so a
// test can prove the markup it reads is there and that the script is linked.
describe("moving between lists", () => {
  test("the page carries one switch per list", () => {
    const html = page();

    for (const tab of ["backlog", "active", "disqualified", "work-log"]) {
      expect(html).toContain(`data-tab="${tab}"`);
    }
  });

  test("the page links the script that does the switching", () => {
    expect(page()).toContain("/scripts/dashboard.js");
  });

  test("the page links the stylesheet", () => {
    expect(page()).toContain("/styles/styles.css");
  });

  // What is hidden is said with a class the stylesheet defines, rather than a
  // style written into the markup, so the browser script has something to
  // switch rather than a value to set.
  test("only the first list is showing when the page opens", () => {
    const html = page();

    expect(html).toContain(`data-panel="active" class="is-hidden"`);
    expect(html).toContain(`data-panel="disqualified" class="is-hidden"`);
    expect(html).toContain(`data-panel="work-log" class="is-hidden"`);
  });

  test("the list that opens first is not hidden", () => {
    expect(page()).toContain(`<div data-panel="backlog">`);
  });
});

describe("the whole document", () => {
  test("is a complete html page", () => {
    const html = page();

    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("</html>");
  });

  test("each job list says how many jobs it holds", () => {
    const html = page({
      backlog: [job("b1", "backlog"), job("b2", "backlog")],
      active: [job("a1", "app. sent")],
    });

    expect(html).toContain("(2)");
    expect(html).toContain("(1)");
  });
});

// The unjudged marker is drawn from the icon set's regular weight, which the
// page has to load beside the bold weight every other icon uses.
describe("the icon weights the page loads", () => {
  test("the regular weight is loaded beside the bold one", () => {
    const html = pageView({ backlog: [], active: [], disqualified: [], workLog: [] });

    expect(html).toContain("@phosphor-icons/web@2.1.1/src/bold/style.css");
    expect(html).toContain("@phosphor-icons/web@2.1.1/src/regular/style.css");
  });
});

// The switch that hides unjudged backlog jobs sits in the tab bar and belongs
// to the backlog alone.
describe("the hide unjudged switch", () => {
  function judged(id: string): JobRow {
    const row = job(id, "backlog");
    return { ...row, job: { ...row.job, is_judged: true } };
  }

  function unjudged(id: string): JobRow {
    const row = job(id, "backlog");
    return { ...row, job: { ...row.job, is_judged: false } };
  }

  test("counts every unjudged backlog job", () => {
    const html = page({ backlog: [unjudged("a"), unjudged("b"), judged("c")] });

    expect(html).toMatch(/Hide Unjudged <span class="unjudged-toggle-count">\(2\)<\/span>/);
  });

  test("the backlog tab still counts every backlog job", () => {
    const html = page({ backlog: [unjudged("a"), unjudged("b"), judged("c")] });

    expect(html).toContain('data-tab="backlog">Backlog <span class="tab-nav-count">(3)</span>');
  });

  test("is an on-off switch", () => {
    expect(page({ backlog: [unjudged("a")] })).toMatch(
      /<input type="checkbox" role="switch" class="switch" data-unjudged-toggle>/
    );
  });

  // The browser script restores a saved choice, so the page itself always
  // draws the switch off, which shows every job on a first visit.
  test("is drawn off", () => {
    expect(page({ backlog: [unjudged("a")] })).not.toMatch(/data-unjudged-toggle[^>]*checked/);
  });

  test("shows on the backlog tab only", () => {
    expect(page({ backlog: [unjudged("a")] })).toMatch(
      /<label class="unjudged-toggle" data-shows-on="backlog">/
    );
  });
});
