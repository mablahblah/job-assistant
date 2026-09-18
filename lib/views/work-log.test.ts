import { describe, expect, test } from "vitest";
import type { CompanyRecord } from "../services/company-service";
import type { WorkLogRow } from "../types/work-log-row";
import { workLogView } from "./work-log";

// Local time throughout, because a benefit week is a run of local days.
function localDate(year: number, month: number, day: number, hour = 12): Date {
  return new Date(year, month - 1, day, hour);
}

const NOW = localDate(2026, 4, 20);

function employer(fields: Partial<CompanyRecord> = {}): CompanyRecord {
  return {
    id: "company-1",
    name: "Acme",
    match_key: "acme",
    employee_satisfaction: null,
    customer_satisfaction: null,
    work_life_balance: null,
    political_alignment: null,
    employee_satisfaction_rationale: null,
    customer_satisfaction_rationale: null,
    work_life_balance_rationale: null,
    political_alignment_rationale: null,
    scored_at: null,
    scores_guessed: [],
    address: "100 Congress Ave, Austin, TX",
    phone: "512-555-0100",
    website: "https://acme.example.com",
    enriched_at: null,
    enrichment_status: "complete",
    enrichment_uncertain: false,
    enrichment_flags: [],
    ...fields,
  };
}

function entry(when: Date, fields: Partial<WorkLogRow["entry"]> = {}, company: CompanyRecord | null = employer()): WorkLogRow {
  return {
    entry: {
      id: "entry-1",
      job_id: "job-1",
      company_name: "Acme",
      job_title: "Senior Product Designer",
      activity: "Applied for job",
      created_at: when,
      ...fields,
    },
    company,
  };
}

// Criterion 163. The form is filed one benefit week at a time, so the page is
// read one week at a time too.
describe("grouping by week", () => {
  test("an entry appears under the week it was written in", () => {
    const html = workLogView([entry(localDate(2026, 4, 20))], NOW);

    expect(html).toContain(localDate(2026, 4, 19, 0).toISOString());
  });

  test("entries written in different weeks land under different weeks", () => {
    const html = workLogView(
      [
        entry(localDate(2026, 4, 20), { id: "this-week", job_title: "This Week Role" }),
        entry(localDate(2026, 4, 15), { id: "last-week", job_title: "Last Week Role" }),
      ],
      NOW
    );

    const thisWeek = localDate(2026, 4, 19, 0).toISOString();
    const lastWeek = localDate(2026, 4, 12, 0).toISOString();

    expect(html).toContain(thisWeek);
    expect(html).toContain(lastWeek);
    expect(html.indexOf("This Week Role")).toBeLessThan(html.indexOf("Last Week Role"));
  });

  // Criterion 173. A week nothing was filed in is the one the user most needs
  // to see, because it is the week still owing activities.
  test("a week holding nothing says so", () => {
    const html = workLogView([entry(localDate(2026, 4, 6))], NOW);

    expect(html).toContain("No activities this week.");
  });

  test("the whole log says so where nothing has ever been filed", () => {
    const html = workLogView([], NOW);

    expect(html).toContain("empty-state");
    expect(html.toLowerCase()).not.toContain("could not");
  });
});

// Criteria 164 to 167.
describe("what an entry shows", () => {
  test("its date of activity is the date it was written", () => {
    const html = workLogView([entry(localDate(2026, 4, 20))], NOW);

    expect(html).toContain("Apr 20, 2026");
  });

  // Criteria 165 and 166. The entry carries the name and the title copied at
  // the moment it was filed, and a later rename must not change what was filed.
  test("the employer name comes from the entry rather than the employer", () => {
    const html = workLogView(
      [entry(localDate(2026, 4, 20), { company_name: "Acme As Filed" }, employer({ name: "Acme Renamed" }))],
      NOW
    );

    expect(html).toContain("Acme As Filed");
    expect(html).not.toContain("Acme Renamed");
  });

  test("the job title comes from the entry", () => {
    const html = workLogView(
      [entry(localDate(2026, 4, 20), { job_title: "Staff Designer As Filed" })],
      NOW
    );

    expect(html).toContain("Staff Designer As Filed");
  });

  test("the activity is shown as it was filed", () => {
    const html = workLogView([entry(localDate(2026, 4, 20), { activity: "Had interview" })], NOW);

    expect(html).toContain("Had interview");
  });

  // Criterion 167. The only wording the Texas form accepts in this field.
  test("the result reads Application filed", () => {
    expect(workLogView([entry(localDate(2026, 4, 20))], NOW)).toContain("Application filed");
  });
});

// Criteria 168, 169, 170, 171 and 172.
describe("the employer's contact details", () => {
  test("shows the address", () => {
    expect(workLogView([entry(localDate(2026, 4, 20))], NOW)).toContain("100 Congress Ave, Austin, TX");
  });

  test("shows the phone number", () => {
    expect(workLogView([entry(localDate(2026, 4, 20))], NOW)).toContain("512-555-0100");
  });

  test("shows the website", () => {
    expect(workLogView([entry(localDate(2026, 4, 20))], NOW)).toContain("https://acme.example.com");
  });

  test("says the details were not found where the job no longer exists", () => {
    const html = workLogView([entry(localDate(2026, 4, 20), {}, null)], NOW);

    expect(html).toContain("Company info not found");
  });

  test("says the details were not found where the job has no employer", () => {
    const html = workLogView([entry(localDate(2026, 4, 20), {}, null)], NOW);

    expect(html).toContain("Company info not found");
  });

  test("says the details were not found where the employer holds none of them", () => {
    const html = workLogView(
      [entry(localDate(2026, 4, 20), {}, employer({ address: null, phone: null, website: null }))],
      NOW
    );

    expect(html).toContain("Company info not found");
  });
});

// Criterion 179. A doubt the contact search raised belongs in the run's own
// report, not on the page the details are transcribed from.
describe("doubts from the employer search", () => {
  test("no doubt reaches the page", () => {
    const html = workLogView(
      [
        entry(
          localDate(2026, 4, 20),
          {},
          employer({ enrichment_uncertain: true, enrichment_flags: ["missing_phone"] })
        ),
      ],
      NOW
    );

    expect(html).not.toContain("missing_phone");
  });
});

// A stored value reaching an attribute has to be escaped, the same way a job
// row's does.
describe("a stored value holding markup", () => {
  test("cannot break the entry", () => {
    const html = workLogView(
      [entry(localDate(2026, 4, 20), { company_name: 'Acme "Holdings" <b>' })],
      NOW
    );

    expect(html).toContain("&quot;Holdings&quot;");
    expect(html).toContain("&lt;b&gt;");
  });
});
