import { describe, expect, test } from "vitest";
import { promoteCompanies } from "./company-promotion";
import { fakeAtsSlugService } from "../services/ats-slug-service.fake";
import { unscoredCompany } from "../services/company-service.fake";
import type { AtsSlugRecord } from "../services/ats-slug-service";
import type { CompanyRecord } from "../services/company-service";
import type { TraceEvent, TraceService } from "../services/trace-service";

const PROMOTION_THRESHOLD = 3.5;
const RUN_ID = "test-run-id";
const STEP = "company_promotion";

interface FakeTraceService extends TraceService {
  events: TraceEvent[];
}

function makeTraceService(): FakeTraceService {
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

function scoredCompany(overrides: Partial<CompanyRecord> = {}): CompanyRecord {
  return unscoredCompany({
    id: "c1",
    name: "Good Co",
    match_key: "goodco",
    employee_satisfaction: 4,
    customer_satisfaction: 4,
    work_life_balance: 4,
    political_alignment: 4,
    scored_at: new Date("2026-09-15T00:00:00.000Z"),
    ...overrides,
  });
}

function slugRow(overrides: Partial<AtsSlugRecord> = {}): AtsSlugRecord {
  return {
    id: "s1",
    slug: "goodco",
    company_id: "c1",
    parser: "greenhouse",
    collector: null,
    ...overrides,
  };
}

async function eventsFrom(
  company: CompanyRecord,
  rows: AtsSlugRecord[]
): Promise<TraceEvent[]> {
  const trace = makeTraceService();
  await promoteCompanies([company], {
    promotionThreshold: PROMOTION_THRESHOLD,
    atsSlugs: fakeAtsSlugService(rows),
    trace,
    runId: RUN_ID,
    step: STEP,
  });
  return trace.events;
}

// Every judging step writes an entering row, so a summary heading can say what
// the step was handed even where the step later died.
describe("every company handed to promotion", () => {
  test("leaves an entering row", async () => {
    const events = await eventsFrom(scoredCompany(), [slugRow()]);

    expect(events[0]).toEqual({
      run_id: RUN_ID,
      company_id: "c1",
      step: STEP,
      event: "company_entered",
    });
  });
});

// Criterion 57. A company that was added to a polling list says so under its
// own step name, kept apart from the job promotion that shares the word.
describe("a company that was added to a polling list", () => {
  test("leaves a promoted row", async () => {
    const events = await eventsFrom(scoredCompany(), [slugRow()]);

    expect(events[1]).toEqual({
      run_id: RUN_ID,
      company_id: "c1",
      step: STEP,
      event: "company_promoted",
    });
  });
});

// Criterion 58. A company that was not added says why, so the summary's lines
// account for every company the step was handed.
describe("a company that was not added", () => {
  test("a low average is recorded under the threshold", async () => {
    const events = await eventsFrom(
      scoredCompany({
        employee_satisfaction: 3,
        customer_satisfaction: 3,
        work_life_balance: 3,
        political_alignment: 3,
      }),
      [slugRow()]
    );

    expect(events[1]).toEqual({
      run_id: RUN_ID,
      company_id: "c1",
      step: STEP,
      event: "company_promotion_skipped",
      reason: "below_promotion_threshold",
    });
  });

  test("a board no collector polls is recorded as such", async () => {
    const events = await eventsFrom(scoredCompany(), [slugRow({ parser: "dribbble" })]);

    expect(events[1]?.reason).toBe("no_pollable_board");
  });

  test("a company with no board at all is recorded the same way", async () => {
    const events = await eventsFrom(scoredCompany(), []);

    expect(events[1]?.reason).toBe("no_pollable_board");
  });

  test("a board already being polled is recorded as already polled", async () => {
    const events = await eventsFrom(scoredCompany(), [slugRow({ collector: "greenhouse" })]);

    expect(events[1]?.reason).toBe("already_polled");
  });

  test("a company still missing a score is recorded as not fully scored", async () => {
    const events = await eventsFrom(scoredCompany({ political_alignment: null }), [slugRow()]);

    expect(events[1]?.reason).toBe("not_fully_scored");
  });
});

// A handler handed neither a trace service nor a run still does its work, which
// is what lets it run outside a job search.
describe("promotion without a trace service", () => {
  test("still adds the collector", async () => {
    const rows = [slugRow()];
    await promoteCompanies([scoredCompany()], {
      promotionThreshold: PROMOTION_THRESHOLD,
      atsSlugs: fakeAtsSlugService(rows),
    });

    expect(rows[0]?.collector).toBe("greenhouse");
  });
});
