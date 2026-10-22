// A stateful stand-in AtsSlugService for tests that write and read board
// rows without touching a database. Like the company fake, this one has to
// remember what happened between calls, so it mirrors the real service's two
// rules against the array the caller passed in: one row per slug, and a
// collector already on a row is never overwritten. For the listPolled() method,
// a test passes in company names since this fake holds no company table.
import type { AtsSlugRecord, AtsSlugService, PolledAtsSlugRecord, RecordInput, RecordResult } from "./ats-slug-service";

export function fakeAtsSlugService(
  rows: AtsSlugRecord[] = [],
  overrides: Partial<AtsSlugService> = {},
  companyNames: Record<string, string> = {}
): AtsSlugService {
  // Ids only need to be unique for the lifetime of one fake, so a simple
  // per-instance counter is enough — no need for a real id generator.
  let nextId = 0;
  function generateId(): string {
    nextId += 1;
    return `fake-ats-slug-${nextId}`;
  }

  async function findBySlug(slug: string): Promise<AtsSlugRecord | null> {
    return rows.find((row) => row.slug === slug) ?? null;
  }

  async function record(input: RecordInput): Promise<RecordResult> {
    const existing = await findBySlug(input.slug);
    if (existing) return { row: existing, created: false };

    const row: AtsSlugRecord = {
      id: generateId(),
      slug: input.slug,
      company_id: input.company_id,
      parser: input.parser,
      collector: null,
    };
    // Mutate the caller's own array so it can seed rows and read back what
    // the fake did.
    rows.push(row);
    return { row, created: true };
  }

  async function addCollector(slug: string, collector: string): Promise<AtsSlugRecord | null> {
    const target = rows.find((row) => row.slug === slug);
    if (!target) return null;
    if (target.collector !== null) return target;

    // Changed in place so the caller's array reflects the write.
    target.collector = collector;
    return target;
  }

  async function listForCollector(collector: string): Promise<AtsSlugRecord[]> {
    return rows.filter((row) => row.collector === collector);
  }

  async function listForCompany(companyId: string): Promise<AtsSlugRecord[]> {
    return rows.filter((row) => row.company_id === companyId);
  }

  async function listPolled(): Promise<PolledAtsSlugRecord[]> {
    return rows
      .filter((row) => row.collector !== null)
      .map((row) => ({
        ...row,
        company_name: companyNames[row.company_id] ?? null,
      }));
  }

  return {
    record,
    findBySlug,
    addCollector,
    listForCollector,
    listForCompany,
    listPolled,
    ...overrides,
  };
}
