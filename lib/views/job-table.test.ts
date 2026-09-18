import { describe, expect, test } from "vitest";
import type { CompanyRecord } from "../services/company-service";
import type { JobListEntry } from "../types/job-list-entry";
import type { JobRow } from "../types/job-row";
import { jobTableView } from "./job-table";

const NOW = new Date("2026-04-20T12:00:00Z");

function employer(fields: Partial<CompanyRecord> = {}): CompanyRecord {
  return {
    id: "company-1",
    name: "Acme",
    match_key: "acme",
    employee_satisfaction: 4,
    customer_satisfaction: 4,
    work_life_balance: 4,
    political_alignment: 4,
    employee_satisfaction_rationale: null,
    customer_satisfaction_rationale: null,
    work_life_balance_rationale: null,
    political_alignment_rationale: null,
    scored_at: null,
    scores_guessed: [],
    address: null,
    phone: null,
    website: null,
    enriched_at: null,
    enrichment_status: null,
    enrichment_uncertain: false,
    enrichment_flags: [],
    ...fields,
  };
}

function row(job: JobListEntry = {}, company: CompanyRecord | null = employer()): JobRow {
  return {
    job: {
      id: "job-1",
      title: "Senior Product Designer",
      status: "backlog",
      original_url: "https://boards.example.com/job-1",
      posting_date: new Date("2026-04-18T12:00:00Z"),
      modified_at: new Date("2026-04-18T12:00:00Z"),
      alignment_score: 4,
      ...job,
    },
    company,
  };
}

function countOf(html: string, tag: "th" | "td"): number {
  return (html.match(new RegExp(`<${tag}[\\s>]`, "g")) ?? []).length;
}

// Criterion 108. "Nothing here" and "something broke" must not read alike.
describe("a list holding nothing", () => {
  test.each(["backlog", "active", "disqualified"] as const)("%s says it is empty", (list) => {
    const html = jobTableView([], list, NOW);

    expect(html).toContain("empty-state");
    expect(html.toLowerCase()).not.toContain("could not");
  });

  test("each list says it in its own words", () => {
    const backlog = jobTableView([], "backlog", NOW);
    const active = jobTableView([], "active", NOW);

    expect(backlog).not.toBe(active);
  });
});

// Criteria 114, 137 and 139. The backlog is a shortlist to work down, so the
// strongest sits at the top. The other two are a record of what happened, so
// what changed last sits at the top.
describe("the order of a list", () => {
  test("the backlog leads with the highest total", () => {
    const weak = row({ title: "Weak Job", alignment_score: 1 }, employer({ employee_satisfaction: 1 }));
    const strong = row({ title: "Strong Job", alignment_score: 5 }, employer({ employee_satisfaction: 5 }));

    const html = jobTableView([weak, strong], "backlog", NOW);

    expect(html.indexOf("Strong Job")).toBeLessThan(html.indexOf("Weak Job"));
  });

  test.each(["active", "disqualified"] as const)(
    "the %s list leads with the most recently changed",
    (list) => {
      const older = row({ title: "Older Job", modified_at: new Date("2026-04-01T12:00:00Z") });
      const newer = row({ title: "Newer Job", modified_at: new Date("2026-04-19T12:00:00Z") });

      const html = jobTableView([older, newer], list, NOW);

      expect(html.indexOf("Newer Job")).toBeLessThan(html.indexOf("Older Job"));
    }
  );
});

// Criteria 115, 116, 117 and 122.
describe("the job's title and its link", () => {
  test("the row shows the title", () => {
    expect(jobTableView([row()], "backlog", NOW)).toContain("Senior Product Designer");
  });

  test("the posting opens in a new tab", () => {
    expect(jobTableView([row()], "backlog", NOW)).toContain('target="_blank"');
  });

  test("the title links to the followed address where there is one", () => {
    const html = jobTableView(
      [row({ resolved_url: "https://source.example.com/real", original_url: "https://aggregator.example.com/redirect" })],
      "backlog",
      NOW
    );

    expect(html).toContain("https://source.example.com/real");
    expect(html).not.toContain("https://aggregator.example.com/redirect");
  });

  test("the title falls back to the address the job was found at", () => {
    const html = jobTableView([row({ resolved_url: null })], "backlog", NOW);

    expect(html).toContain("https://boards.example.com/job-1");
  });
});

// Criteria 124, 125 and 126.
describe("naming the employer", () => {
  test("shows the stored employer name", () => {
    expect(jobTableView([row()], "backlog", NOW)).toContain("Acme");
  });

  test("falls back to the name the collector wrote onto the job", () => {
    const html = jobTableView(
      [row({ raw_company_name: "Acme Corporation" }, employer({ name: null }))],
      "backlog",
      NOW
    );

    expect(html).toContain("Acme Corporation");
  });

  test("shows a dash where the job has no employer at all", () => {
    const html = jobTableView([row({ raw_company_name: null }, null)], "backlog", NOW);

    expect(html).toContain("—");
  });
});

// Criteria 127, 128 and 129. A job the pipeline never classified has no
// matched place, and the disqualified list is full of those.
describe("where the job is", () => {
  test("shows the place that matched the search area", () => {
    const html = jobTableView([row({ location_match_place: "Austin, TX" })], "backlog", NOW);

    expect(html).toContain("Austin, TX");
  });

  test("falls back to every tidied place, separated by commas", () => {
    const html = jobTableView(
      [row({ location_match_place: null, normalized_location_list: ["Austin", "Dallas"] })],
      "disqualified",
      NOW
    );

    expect(html).toContain("Austin, Dallas");
  });

  test("falls back again to every place as collected", () => {
    const html = jobTableView(
      [
        row({
          location_match_place: null,
          normalized_location_list: null,
          raw_location_list: ["Austin, TX or Remote"],
        }),
      ],
      "disqualified",
      NOW
    );

    expect(html).toContain("Austin, TX or Remote");
  });
});

// Criteria 130, 131 and 132.
describe("how the job is worked", () => {
  test("shows the way of working that matched", () => {
    const html = jobTableView([row({ location_match_mode: "remote" })], "backlog", NOW);

    expect(html).toContain("Remote");
  });

  test("takes remote ahead of hybrid where nothing matched", () => {
    const html = jobTableView(
      [row({ location_match_mode: null, normalized_mode_list: ["hybrid", "remote"] })],
      "disqualified",
      NOW
    );

    expect(html).toContain("Remote");
  });

  test("takes hybrid ahead of in-person", () => {
    const html = jobTableView(
      [row({ location_match_mode: null, normalized_mode_list: ["in-person", "hybrid"] })],
      "disqualified",
      NOW
    );

    expect(html).toContain("Hybrid");
  });

  test("says the way of working is not known where the list is empty", () => {
    const html = jobTableView(
      [row({ location_match_mode: null, normalized_mode_list: [] })],
      "disqualified",
      NOW
    );

    expect(html).toContain("Unknown");
  });
});

// Criteria 133, 134 and 135.
describe("what the job pays", () => {
  test("builds a range from the two figures and the period", () => {
    const html = jobTableView(
      [row({ salary_low: 150_000, salary_high: 188_000, salary_period: "year" })],
      "backlog",
      NOW
    );

    expect(html).toContain("150,000");
    expect(html).toContain("188,000");
    expect(html).toContain("year");
  });

  test("shows a question mark where no figure was stored", () => {
    const html = jobTableView([row({ salary_low: null, salary_high: null })], "backlog", NOW);

    expect(html).not.toContain("$");
  });

  test("shows a question mark where the period cannot be read", () => {
    const html = jobTableView(
      [row({ salary_low: 5_000, salary_high: 5_000, salary_period: "project" })],
      "backlog",
      NOW
    );

    expect(html).not.toContain("5,000");
    expect(html).not.toContain("$");
  });
});

// Criteria 119, 120, 121 and 123.
describe("when the job was posted", () => {
  test("the row shows how long ago it was posted", () => {
    expect(jobTableView([row()], "backlog", NOW)).toContain("2d ago");
  });

  test("a job posted again carries a mark", () => {
    const html = jobTableView(
      [row({ is_repost: true, posting_updated_date: new Date("2026-04-19T12:00:00Z") })],
      "backlog",
      NOW
    );

    expect(html).toContain("repost-pill");
  });

  test("a job posted once carries no mark", () => {
    expect(jobTableView([row()], "backlog", NOW)).not.toContain("repost-pill");
  });

  test("the mark says when the posting last changed", () => {
    const html = jobTableView(
      [row({ is_repost: true, posting_updated_date: new Date("2026-04-19T12:00:00Z") })],
      "backlog",
      NOW
    );

    expect(html).toContain("1d ago");
  });
});

// Criteria 118, 140, 141, 142 and 143.
describe("the total and the status", () => {
  test("the backlog shows a total", () => {
    expect(jobTableView([row()], "backlog", NOW)).toContain("col-score");
  });

  test.each(["active", "disqualified"] as const)("the %s list shows no total", (list) => {
    expect(jobTableView([row()], list, NOW)).not.toContain("col-score");
  });

  test("an applied-to job shows its status", () => {
    const html = jobTableView([row({ status: "interview" })], "active", NOW);

    expect(html).toContain("interview");
  });

  test("a ruled-out job shows its status", () => {
    const html = jobTableView([row({ status: "unparseable" })], "disqualified", NOW);

    expect(html).toContain("unparseable");
  });

  test.each(["backlog", "active", "disqualified"] as const)(
    "the %s list still shows five ratings",
    (list) => {
      const html = jobTableView([row()], list, NOW);

      expect((html.match(/<td class="col-rating-individual text-center">/g) ?? []).length).toBe(5);
    }
  );
});

// Criterion 145. One builder serves all three lists, and nothing else checks
// that its headings and its cells stay in step.
describe("headings and cells", () => {
  test.each(["backlog", "active", "disqualified"] as const)(
    "the %s list has as many cells in a row as it has headings",
    (list) => {
      const html = jobTableView([row()], list, NOW);

      expect(countOf(html, "td")).toBe(countOf(html, "th"));
    }
  );
});

// Criteria 157 to 162.
describe("the reasoning behind a total", () => {
  test("the total carries the job's own reasoning", () => {
    const html = jobTableView(
      [
        row(
          { alignment_rationale: "A close match for the role." },
          employer({ employee_satisfaction_rationale: "People stay for years." })
        ),
      ],
      "backlog",
      NOW
    );

    expect(html).toContain("A close match for the role.");
  });

  // Replaced on 2026-09-17. All five categories were tried and judged by eye:
  // more text than a browser tooltip can show.
  test("the employer's reasoning stays off the total", () => {
    const html = jobTableView(
      [
        row(
          { alignment_rationale: "A close match for the role." },
          employer({ employee_satisfaction_rationale: "People stay for years." })
        ),
      ],
      "backlog",
      NOW
    );

    expect(html).not.toContain("People stay for years.");
  });

  test("a total with no reasoning carries nothing to rest on", () => {
    const html = jobTableView([row()], "backlog", NOW);

    expect(html).not.toContain("title=\"A close match");
  });

  // Criterion 161. The reasoning goes into an attribute, so a quotation mark
  // in it would close that attribute and take the rest of the row with it.
  test("reasoning holding a quotation mark leaves the row whole", () => {
    const html = jobTableView(
      [row({ alignment_rationale: 'They call it a "growth" role <b>' })],
      "backlog",
      NOW
    );

    expect(html).toContain("&quot;growth&quot;");
    expect(html).toContain("&lt;b&gt;");
    expect(countOf(html, "td")).toBe(countOf(html, "th"));
  });

  test.each(["active", "disqualified"] as const)(
    "no reasoning is reachable from the %s list",
    (list) => {
      const html = jobTableView(
        [row({ alignment_rationale: "A close match for the role." })],
        list,
        NOW
      );

      expect(html).not.toContain("A close match for the role.");
    }
  );
});

// Criterion 179. A doubt raised by the employer contact search belongs in the
// run's own report, not on a page the user reads to decide what to apply to.
describe("doubts from the employer search", () => {
  test("no doubt reaches the page", () => {
    const html = jobTableView(
      [row({}, employer({ enrichment_uncertain: true, enrichment_flags: ["missing_phone"] }))],
      "backlog",
      NOW
    );

    expect(html).not.toContain("missing_phone");
  });
});
