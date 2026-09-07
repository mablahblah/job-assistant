// A stateful stand-in CompanyService for tests that create, look up, and
// update companies without touching a database. Unlike the project's other
// fakes this one must remember what happened between calls, so it mirrors
// the real service's name / match_key / slug uniqueness rules against the
// array the caller passed in — a company created by one call is then
// findable by the next.
import { companyMatchKey } from "./company-match-key";
import type {
  CompanyRecord,
  CompanyService,
  CreateInput,
  CreateResult,
  FillNameResult,
} from "./company-service";

export function fakeCompanyService(
  companies: CompanyRecord[] = [],
  overrides: Partial<CompanyService> = {}
): CompanyService {
  // Ids only need to be unique for the lifetime of one fake, so a simple
  // per-instance counter is enough — no need for a real id generator.
  let nextId = 0;
  function generateId(): string {
    nextId += 1;
    return `fake-company-${nextId}`;
  }

  async function findBySlug(slug: string): Promise<CompanyRecord | null> {
    return companies.find((company) => company.ats_slug === slug) ?? null;
  }

  async function findByMatchKey(matchKey: string): Promise<CompanyRecord | null> {
    return companies.find((company) => company.match_key === matchKey) ?? null;
  }

  async function findByName(name: string): Promise<CompanyRecord | null> {
    return companies.find((company) => company.name === name) ?? null;
  }

  // There is no database here to refuse a write, so nothing names the
  // clashing column the way a real refusal does. Each candidate value is
  // checked before the write instead, and whichever one is already held is
  // the blocker.
  async function findConflict(
    name: string | null,
    matchKey: string | null,
    slug: string | null
  ): Promise<CompanyRecord | null> {
    if (name) {
      const byName = await findByName(name);
      if (byName) return byName;
    }
    if (matchKey) {
      const byMatchKey = await findByMatchKey(matchKey);
      if (byMatchKey) return byMatchKey;
    }
    if (slug) return findBySlug(slug);
    return null;
  }

  async function create(input: CreateInput): Promise<CreateResult> {
    // An empty-string name is treated as no name at all.
    const trimmedName = input.name?.trim();
    const name = trimmedName ? trimmedName : null;
    if (!name && !input.ats_slug) {
      throw new Error("Company.create requires either a name or a slug to identify the company.");
    }
    const match_key = name ? companyMatchKey(name) : null;
    const ats_slug = input.ats_slug ?? null;

    const blocker = await findConflict(name, match_key, ats_slug);
    if (blocker) {
      return { company: blocker, created: false };
    }

    const company: CompanyRecord = {
      id: generateId(),
      name,
      match_key,
      ats_platform: input.ats_platform ?? null,
      ats_slug,
    };
    // Mutate the caller's own array so it can seed rows and read back
    // what the fake did.
    companies.push(company);
    return { company, created: true };
  }

  async function fillName(id: string, name: string): Promise<FillNameResult> {
    const match_key = companyMatchKey(name);
    const target = companies.find((company) => company.id === id);
    if (!target) {
      throw new Error(`Company.fillName: no company found with id "${id}".`);
    }

    const heldBy = await findConflict(name, match_key, null);
    if (heldBy && heldBy.id !== id) {
      return { company: target, filled: false, heldBy };
    }

    // Mutate the record in place so the caller's array reflects the write.
    // ats_platform / ats_slug are never touched here.
    target.name = name;
    target.match_key = match_key;
    return { company: target, filled: true, heldBy: null };
  }

  return {
    findBySlug,
    findByMatchKey,
    create,
    fillName,
    ...overrides,
  };
}
