import { describe, expect, test } from "vitest";
import { saveCompanies } from "./save";
import type { CompanyRecord } from "../services/company-service";
import { fakeCompanyService, unscoredCompany } from "../services/company-service.fake";
import type { TraceEvent, TraceService } from "../services/trace-service";

const RUN_ID = "run-1";
const STEP = "backlog_cleanup";
const SCORED_AT = new Date("2026-09-15T00:00:00.000Z");

function scored(id: string): CompanyRecord {
  return unscoredCompany({
    id,
    name: `Company ${id}`,
    employee_satisfaction: 4,
    employee_satisfaction_rationale: "well reviewed",
    scored_at: SCORED_AT,
  });
}

// Records every event handed to it instead of writing to a database.
function createFakeTraceService(): TraceService & { events: TraceEvent[] } {
  const events: TraceEvent[] = [];
  return {
    events,
    async write(event) {
      events.push(event);
    },
    async countsForRun() {
      return [];
    },
    failureCount() {
      return 0;
    },
  };
}

// Criterion 62. Nothing here reaches the database itself: the service it is
// handed owns the table.
describe("saving a company list", () => {
  test("each company is written through the company service", async () => {
    const stored = [unscoredCompany({ id: "c1" }), unscoredCompany({ id: "c2" })];
    const companyService = fakeCompanyService(stored);

    await saveCompanies([scored("c1"), scored("c2")], { companyService });

    expect(stored.map((company) => company.employee_satisfaction)).toEqual([4, 4]);
  });

  test("an emptied score block lands as empty rather than being skipped", async () => {
    const stored = [scored("c1")];
    const companyService = fakeCompanyService(stored);

    await saveCompanies([unscoredCompany({ id: "c1", name: "Company c1" })], { companyService });

    expect(stored[0]?.employee_satisfaction).toBeNull();
    expect(stored[0]?.scored_at).toBeNull();
  });

  // Criteria 64 and 64a.
  test("the list handed in comes back", async () => {
    const companyService = fakeCompanyService([
      unscoredCompany({ id: "c1" }),
      unscoredCompany({ id: "c2" }),
    ]);

    const result = await saveCompanies([scored("c1"), scored("c2")], { companyService });

    expect(result.companies.map((company) => company.id)).toEqual(["c1", "c2"]);
  });

  test("an empty list comes back empty", async () => {
    const result = await saveCompanies([], { companyService: fakeCompanyService() });

    expect(result.companies).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});

// A failed write costs that one company. A run that gave up on the rest would
// throw away research nobody is going to pay for twice.
describe("a write the service refuses", () => {
  function explodingService(failingId: string) {
    return fakeCompanyService([], {
      writeScores: async (company: CompanyRecord) => {
        if (company.id === failingId) throw new Error("database is locked");
        return company;
      },
    });
  }

  test("the run carries on to the next company", async () => {
    const written: string[] = [];
    const companyService = fakeCompanyService([], {
      writeScores: async (company: CompanyRecord) => {
        if (company.id === "c1") throw new Error("database is locked");
        written.push(company.id);
        return company;
      },
    });

    await saveCompanies([scored("c1"), scored("c2")], { companyService });

    expect(written).toEqual(["c2"]);
  });

  test("the failure is returned as a warning naming the company", async () => {
    const result = await saveCompanies([scored("c1")], {
      companyService: explodingService("c1"),
    });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.message).toContain("c1");
  });

  test("the company is still on the list handed back", async () => {
    const result = await saveCompanies([scored("c1")], {
      companyService: explodingService("c1"),
    });

    expect(result.companies.map((company) => company.id)).toEqual(["c1"]);
  });
});

describe("the rows the company save writes", () => {
  test("a written company gets a row naming it", async () => {
    const trace = createFakeTraceService();
    await saveCompanies([scored("c1")], {
      companyService: fakeCompanyService([unscoredCompany({ id: "c1" })]),
      trace,
      runId: RUN_ID,
      step: STEP,
    });

    expect(trace.events[0]?.company_id).toBe("c1");
    expect(trace.events[0]?.event).toBe("company_dbrow_updated");
  });

  // Save reuses the word it already writes for a job whose write threw, and
  // the step and reason are what tell the two populations apart.
  test("a failed write records why the entry never landed", async () => {
    const trace = createFakeTraceService();
    await saveCompanies([scored("c1")], {
      companyService: fakeCompanyService([], {
        writeScores: async () => {
          throw new Error("database is locked");
        },
      }),
      trace,
      runId: RUN_ID,
      step: STEP,
    });

    expect(trace.events[0]?.event).toBe("job_abandoned");
    expect(trace.events[0]?.reason).toBe("db_write_failed");
  });

  test("a handler handed no run identifier writes nothing", async () => {
    const trace = createFakeTraceService();
    await saveCompanies([scored("c1")], {
      companyService: fakeCompanyService([unscoredCompany({ id: "c1" })]),
      trace,
      step: STEP,
    });

    expect(trace.events).toEqual([]);
  });
});
