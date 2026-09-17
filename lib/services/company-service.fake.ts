// A stateful stand-in CompanyService for tests that create, look up, and
// update companies without touching a database. Unlike the project's other
// fakes this one must remember what happened between calls, so it mirrors
// the real service's name / match_key / slug uniqueness rules against the
// array the caller passed in — a company created by one call is then
// findable by the next.
import { companyMatchKey } from "../utils/company-match-key";
import type {
  CompanyRecord,
  CompanyService,
  CreateInput,
  CreateResult,
  FillNameResult,
  ScoreCategory,
  ScoreInput,
} from "./company-service";
import { SCORE_CATEGORIES } from "./company-service";
import type { ContactDetails } from "../utils/enrichment-contact";
import type { EnrichmentDoubt } from "../utils/enrichment-doubts";

// A company row with nothing scored yet, which is what every company looks
// like before an agent has researched it. Test fixtures build on this rather
// than spelling out ten empty fields each, so a new column added to the
// record lands in one place.
export function unscoredCompany(fields: Partial<CompanyRecord> & { id: string }): CompanyRecord {
  return {
    name: null,
    match_key: null,
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

  // The real service looks a slug up through the ATS slug table. The fake has
  // no such table, so a test that needs a slug lookup passes an override
  // rather than seeding a column that no longer exists.
  async function findBySlug(_slug: string): Promise<CompanyRecord | null> {
    return null;
  }

  // The status change knows a job's company id and nothing else, so this is
  // where it reads the employer behind that job.
  async function findById(id: string): Promise<CompanyRecord | null> {
    return companies.find((company) => company.id === id) ?? null;
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
    matchKey: string | null
  ): Promise<CompanyRecord | null> {
    if (name) {
      const byName = await findByName(name);
      if (byName) return byName;
    }
    if (matchKey) return findByMatchKey(matchKey);
    return null;
  }

  async function create(input: CreateInput): Promise<CreateResult> {
    // An empty-string name is treated as no name at all.
    const trimmedName = input.name?.trim();
    const name = trimmedName ? trimmedName : null;
    if (!name) {
      throw new Error("Company.create requires a name. Use createNameless for a board's company.");
    }
    const match_key = companyMatchKey(name);

    const blocker = await findConflict(name, match_key);
    if (blocker) {
      return { company: blocker, created: false };
    }

    const company = unscoredCompany({ id: generateId(), name, match_key });
    // Mutate the caller's own array so it can seed rows and read back
    // what the fake did.
    companies.push(company);
    return { company, created: true };
  }

  // A company met only as a board slug. It carries no name and no match key,
  // so nothing can clash with it.
  async function createNameless(): Promise<CompanyRecord> {
    const company = unscoredCompany({ id: generateId() });
    companies.push(company);
    return company;
  }

  async function fillName(id: string, name: string): Promise<FillNameResult> {
    const match_key = companyMatchKey(name);
    const target = companies.find((company) => company.id === id);
    if (!target) {
      throw new Error(`Company.fillName: no company found with id "${id}".`);
    }

    const heldBy = await findConflict(name, match_key);
    if (heldBy && heldBy.id !== id) {
      return { company: target, filled: false, heldBy };
    }

    // Mutate the record in place so the caller's array reflects the write.
    target.name = name;
    target.match_key = match_key;
    return { company: target, filled: true, heldBy: null };
  }

  // Mirrors the real service: only the categories it is given are touched,
  // and the guessed list is rebuilt rather than replaced, so a guess about a
  // category this write never covered survives.
  async function saveScores(
    id: string,
    scores: ScoreInput,
    scoredAt: Date
  ): Promise<CompanyRecord> {
    const target = companies.find((company) => company.id === id);
    if (!target) {
      throw new Error(`Company.saveScores: no company found with id "${id}".`);
    }

    const untouched = target.scores_guessed.filter((category) => scores[category] === undefined);
    const guessedNow = SCORE_CATEGORIES.filter((category) => scores[category]?.guessed === true);

    for (const category of SCORE_CATEGORIES) {
      const answer = scores[category];
      if (answer === undefined) continue;
      writeCategory(target, category, answer.score, answer.rationale);
    }

    target.scored_at = scoredAt;
    target.scores_guessed = SCORE_CATEGORIES.filter(
      (category) => untouched.includes(category) || guessedNow.includes(category)
    );
    return target;
  }

  // Mirrors the real service: the whole score block lands exactly as the
  // record holds it, empty fields included.
  async function writeScores(company: CompanyRecord): Promise<CompanyRecord> {
    const index = companies.findIndex((each) => each.id === company.id);
    if (index === -1) {
      throw new Error(`Company.writeScores: no company found with id "${company.id}".`);
    }
    const stored = { ...company };
    companies[index] = stored;
    return stored;
  }

  // The real query joins to the job table to find companies still holding a
  // backlog job. There are no jobs behind this fake, so a test that needs
  // this answer passes an override rather than seeding a relation.
  async function findNeedingScores(): Promise<CompanyRecord[]> {
    return [];
  }

  async function findScored(): Promise<CompanyRecord[]> {
    return companies.filter((company) => company.scored_at !== null);
  }

  function held(id: string): CompanyRecord {
    const company = companies.find((candidate) => candidate.id === id);
    if (!company) throw new Error(`No company held with id "${id}"`);
    return company;
  }

  // The mark goes down before the search starts, which is what tells a
  // company whose search was cut off partway from one never tried. It touches
  // nothing else, enriched_at included.
  async function startEnrichment(id: string): Promise<CompanyRecord> {
    const company = held(id);
    company.enrichment_status = "pending";
    return company;
  }

  // Recording that a search found nothing and blocking a later search are two
  // different things. Only a search that filled a field in writes enriched_at,
  // which is the one thing that closes a company out.
  async function saveEnrichment(
    id: string,
    found: ContactDetails,
    doubts: readonly EnrichmentDoubt[],
    at: Date
  ): Promise<CompanyRecord> {
    const company = held(id);
    const answered = Boolean(found.address || found.phone || found.website);
    company.address = found.address ?? null;
    company.phone = found.phone ?? null;
    company.website = found.website ?? null;
    // Copied rather than held, so a later change by the caller cannot reach
    // back into a company this fake is holding.
    company.enrichment_flags = [...doubts];
    company.enrichment_uncertain = doubts.length > 0;
    company.enriched_at = answered ? at : null;
    company.enrichment_status = answered ? "complete" : "failed";
    return company;
  }

  return {
    findBySlug,
    findByMatchKey,
    findById,
    findNeedingScores,
    findScored,
    create,
    createNameless,
    fillName,
    saveScores,
    writeScores,
    startEnrichment,
    saveEnrichment,
    ...overrides,
  };
}

// Writes one category's pair of fields. A lookup table rather than a computed
// key, so the record's field names stay checked by the compiler.
function writeCategory(
  company: CompanyRecord,
  category: ScoreCategory,
  score: number,
  rationale: string
): void {
  if (category === "employee_satisfaction") {
    company.employee_satisfaction = score;
    company.employee_satisfaction_rationale = rationale;
    return;
  }
  if (category === "customer_satisfaction") {
    company.customer_satisfaction = score;
    company.customer_satisfaction_rationale = rationale;
    return;
  }
  if (category === "work_life_balance") {
    company.work_life_balance = score;
    company.work_life_balance_rationale = rationale;
    return;
  }
  company.political_alignment = score;
  company.political_alignment_rationale = rationale;
}
