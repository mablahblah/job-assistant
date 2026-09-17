// Owns every read and write of the Company table. Nothing else in the
// codebase talks to Company directly — callers go through the methods here
// so the name and match_key uniqueness rules stay in one place instead of
// being re-solved at every call site. A company's board slugs live in a table
// of their own, so a lookup by slug reads through that table rather than a
// column here.
import type { createPipelineDb } from "../db/pipeline-db";
import { Prisma } from "../../generated/pipeline/client";
import { companyMatchKey } from "../utils/company-match-key";
import { ENRICHMENT_DOUBTS, type EnrichmentDoubt } from "../utils/enrichment-doubts";
import type { ContactDetails } from "../utils/enrichment-contact";

// The four things an agent researches a company on. Named here as one list
// so nothing downstream has to retype them, and so a fifth category could
// only be added in one place.
export const SCORE_CATEGORIES = [
  "employee_satisfaction",
  "customer_satisfaction",
  "work_life_balance",
  "political_alignment",
] as const;

export type ScoreCategory = (typeof SCORE_CATEGORIES)[number];

// One category's answer. guessed travels with the score rather than in a list
// of its own, because the agent knows category by category whether it found
// anything public, and the service is what turns that into the stored list.
export interface CategoryScore {
  score: number;
  rationale: string;
  guessed: boolean;
}

// The categories one write covers. A category left off is one the agent was
// never asked about, and its stored score and reasoning stay exactly as they
// were.
export type ScoreInput = Partial<Record<ScoreCategory, CategoryScore>>;

export interface CompanyRecord {
  id: string;
  name: string | null;
  match_key: string | null;
  employee_satisfaction: number | null;
  customer_satisfaction: number | null;
  work_life_balance: number | null;
  political_alignment: number | null;
  employee_satisfaction_rationale: string | null;
  customer_satisfaction_rationale: string | null;
  work_life_balance_rationale: string | null;
  political_alignment_rationale: string | null;
  scored_at: Date | null;
  // The categories the agent guessed at. Read back as a list of category
  // names; the column behind it is Json, so a row that somehow holds another
  // shape is read as no guesses rather than trusted.
  scores_guessed: ScoreCategory[];
  // The contact details a Texas Workforce Commission filing asks for, filled
  // in by an internet search. A status change has a job's company id and
  // nothing else, so it reads the employer here to see whether it holds a
  // usable name and whether a search has already answered for it.
  address: string | null;
  phone: string | null;
  website: string | null;
  // What says an employer is done. A read that left this off would send every
  // employer back to the paid search on every status change.
  enriched_at: Date | null;
  enrichment_status: string | null;
  enrichment_uncertain: boolean;
  // Narrowed from Json the same way scores_guessed is, and for the same
  // reason: a row holding another shape reads as no doubts rather than being
  // trusted.
  enrichment_flags: EnrichmentDoubt[];
}

export interface CreateInput {
  name?: string | null;
}

export interface CreateResult {
  company: CompanyRecord;
  created: boolean;
}

export interface FillNameResult {
  company: CompanyRecord;
  filled: boolean;
  heldBy: CompanyRecord | null;
}

export interface CompanyService {
  findBySlug(slug: string): Promise<CompanyRecord | null>;
  findByMatchKey(matchKey: string): Promise<CompanyRecord | null>;
  findById(id: string): Promise<CompanyRecord | null>;
  findNeedingScores(): Promise<CompanyRecord[]>;
  findScored(): Promise<CompanyRecord[]>;
  create(input: CreateInput): Promise<CreateResult>;
  createNameless(): Promise<CompanyRecord>;
  fillName(id: string, name: string): Promise<FillNameResult>;
  saveScores(id: string, scores: ScoreInput, scoredAt: Date): Promise<CompanyRecord>;
  writeScores(company: CompanyRecord): Promise<CompanyRecord>;
  startEnrichment(id: string): Promise<CompanyRecord>;
  saveEnrichment(
    id: string,
    found: ContactDetails,
    doubts: readonly EnrichmentDoubt[],
    at: Date
  ): Promise<CompanyRecord>;
}

type PipelineDb = ReturnType<typeof createPipelineDb>;

// Every read/write below selects exactly these columns, so the shape handed
// back always matches CompanyRecord regardless of what else the schema grows.
//
// Exported because the job service's page reads hand back a job and its
// employer side by side, and an employer built from a second column list would
// drift from this one.
export const COMPANY_RECORD_SELECT = {
  id: true,
  name: true,
  match_key: true,
  employee_satisfaction: true,
  customer_satisfaction: true,
  work_life_balance: true,
  political_alignment: true,
  employee_satisfaction_rationale: true,
  customer_satisfaction_rationale: true,
  work_life_balance_rationale: true,
  political_alignment_rationale: true,
  scored_at: true,
  scores_guessed: true,
  address: true,
  phone: true,
  website: true,
  enriched_at: true,
  enrichment_status: true,
  enrichment_uncertain: true,
  enrichment_flags: true,
} as const;

// scores_guessed is a Prisma Json column, so its static type is JsonValue
// rather than a list of category names. This checks the shape at runtime: a
// row holding anything else reads as no guesses, which is the safe answer —
// a category wrongly read as researched would outlive its real shelf life,
// while one wrongly read as a guess is only researched again sooner.
function guessedCategories(value: unknown): ScoreCategory[] {
  if (!Array.isArray(value)) return [];
  return SCORE_CATEGORIES.filter((category) => value.includes(category));
}

// enrichment_flags is a Json column too, narrowed the same way and for the
// same reason. A doubt wrongly read as absent only costs a warning the user
// did not need; a stored shape trusted blind could put anything on a page.
function enrichmentDoubts(value: unknown): EnrichmentDoubt[] {
  if (!Array.isArray(value)) return [];
  return ENRICHMENT_DOUBTS.filter((doubt) => value.includes(doubt));
}

// What every read hands back: the row as the database holds it, with both
// Json lists narrowed to the names they are allowed to hold.
export type CompanyRow = Omit<CompanyRecord, "scores_guessed" | "enrichment_flags"> & {
  scores_guessed: unknown;
  enrichment_flags: unknown;
};

// Exported alongside the column list above, and for the same reason: the one
// place that narrows the two Json columns is the one place that should.
export function toCompanyRecord(row: CompanyRow): CompanyRecord {
  return {
    ...row,
    scores_guessed: guessedCategories(row.scores_guessed),
    enrichment_flags: enrichmentDoubts(row.enrichment_flags),
  };
}

// True for a write the database refused because a unique column already
// holds the value — narrows the error type so its meta and constraint
// details are readable without a cast.
function isUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Reads the column name a driver-level unique-constraint refusal blames. Any
// page that isn't the shape we expect comes back as null rather than
// throwing, so a driver whose error shape changes falls back safely instead
// of crashing the caller.
function columnFromRefusal(error: Prisma.PrismaClientKnownRequestError): string | null {
  const meta = error.meta;
  if (!isRecord(meta)) return null;
  const driverAdapterError = meta.driverAdapterError;
  if (!isRecord(driverAdapterError)) return null;
  const cause = driverAdapterError.cause;
  if (!isRecord(cause)) return null;
  const constraint = cause.constraint;
  if (!isRecord(constraint)) return null;
  const fields = constraint.fields;
  if (!Array.isArray(fields)) return null;
  const [column] = fields;
  return typeof column === "string" ? column : null;
}

export function createCompanyService(db: PipelineDb): CompanyService {
  // Looked up through the ATS slug table rather than a column of its own. A
  // slug is unique across that table, so at most one company can answer, and
  // findFirst is the query Prisma builds for a lookup through a relation.
  async function findBySlug(slug: string): Promise<CompanyRecord | null> {
    const row = await db.company.findFirst({
      where: { ats_slugs: { some: { slug } } },
      select: COMPANY_RECORD_SELECT,
    });
    return row === null ? null : toCompanyRecord(row);
  }

  async function findByMatchKey(matchKey: string): Promise<CompanyRecord | null> {
    const row = await db.company.findUnique({ where: { match_key: matchKey }, select: COMPANY_RECORD_SELECT });
    return row === null ? null : toCompanyRecord(row);
  }

  // The status change knows a job's company id and nothing else, so this is
  // where it reads the employer behind that job.
  async function findById(id: string): Promise<CompanyRecord | null> {
    const row = await db.company.findUnique({ where: { id }, select: COMPANY_RECORD_SELECT });
    return row === null ? null : toCompanyRecord(row);
  }

  async function findByName(name: string): Promise<CompanyRecord | null> {
    const row = await db.company.findUnique({ where: { name }, select: COMPANY_RECORD_SELECT });
    return row === null ? null : toCompanyRecord(row);
  }

  // Used once a refusal names no column, or names one we wrote no value
  // for: check every value we tried to write in turn — whichever one is
  // already occupied is the blocker.
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

  // The column a refusal names is looked up directly, using the value we
  // tried to write there. Where it names none, or names a column we wrote no
  // value for — a slug on an update, for instance — every value we tried is
  // checked in turn instead.
  async function findBlocker(
    column: string | null,
    name: string | null,
    matchKey: string | null
  ): Promise<CompanyRecord | null> {
    if (column === "name" && name) return findByName(name);
    if (column === "match_key" && matchKey) return findByMatchKey(matchKey);
    return findConflict(name, matchKey);
  }

  return {
    findBySlug,
    findByMatchKey,
    findById,

    // Scoring researches every company that still has a live backlog job but
    // has not been fully judged yet, so a ranking is never built on blanks.
    // Prisma's relation filter does the "appears once" work for us: the
    // company row is returned once however many backlog jobs match.
    async findNeedingScores() {
      const rows = await db.company.findMany({
        where: {
          jobs: { some: { status: "backlog" } },
          // Built from SCORE_CATEGORIES so a fifth category joins the check by
          // being added to that list alone. The mapped type keeps the compiler
          // checking each name against the Company columns.
          OR: SCORE_CATEGORIES.map(
            (category): { [K in ScoreCategory]?: null } => ({
              [category]: null,
            })
          ),
        },
        select: COMPANY_RECORD_SELECT,
      });
      return rows.map(toCompanyRecord);
    },

    // Every company an agent has scored. Backlog cleanup sweeps these for
    // judgements that have aged out; a company nothing has scored has no date
    // to measure from and nothing to empty.
    async findScored() {
      const rows = await db.company.findMany({
        where: { scored_at: { not: null } },
        select: COMPANY_RECORD_SELECT,
      });
      return rows.map(toCompanyRecord);
    },

    async create(input) {
      // An empty-string name is treated as no name — a caller passing ""
      // almost certainly forgot to fill it in, not deliberately asking for
      // a nameless company by another name.
      const trimmedName = input.name?.trim();
      const name = trimmedName ? trimmedName : null;
      if (!name) {
        throw new Error("Company.create requires a name. Use createNameless for a board's company.");
      }
      const match_key = companyMatchKey(name);

      try {
        const row = await db.company.create({
          data: { name, match_key },
          select: COMPANY_RECORD_SELECT,
        });
        return { company: toCompanyRecord(row), created: true };
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        // Another company already holds this name or this match key — two job
        // postings for the same employer, not a real failure.
        const blocker = await findBlocker(columnFromRefusal(error), name, match_key);
        if (!blocker) throw error;
        return { company: blocker, created: false };
      }
    },

    // A company met only as a board slug. It has no name and nothing invents
    // one for it; the slug row written beside it is what identifies it, and
    // company association fills the name in from the first job that carries a
    // real one. Nothing can clash, because a row with no name and no match key
    // occupies neither unique column.
    async createNameless() {
      const row = await db.company.create({ data: {}, select: COMPANY_RECORD_SELECT });
      return toCompanyRecord(row);
    },

    async fillName(id, name) {
      const match_key = companyMatchKey(name);
      try {
        const row = await db.company.update({
          where: { id },
          data: { name, match_key },
          select: COMPANY_RECORD_SELECT,
        });
        return { company: toCompanyRecord(row), filled: true, heldBy: null };
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        // Someone else already has this name — two spellings of one
        // employer. Leave the target company as it was and hand back
        // whoever is already holding the name, instead of writing over it.
        // An update never writes a slug, so a slug is never its blocker.
        const [row, heldBy] = await Promise.all([
          db.company.findUniqueOrThrow({ where: { id }, select: COMPANY_RECORD_SELECT }),
          findBlocker(columnFromRefusal(error), name, match_key),
        ]);
        return { company: toCompanyRecord(row), filled: false, heldBy };
      }
    },

    // Writes back what an agent researched. Only the categories it was given
    // are touched, because a company is picked up again whenever any category
    // is empty, and a write covering one category must not blank the three
    // standing beside it.
    async saveScores(id, scores, scoredAt) {
      // An agent researches only the categories a company is missing, so the
      // stored guessed list has to be read before it can be rebuilt.
      const stored = await db.company.findUniqueOrThrow({
        where: { id },
        select: COMPANY_RECORD_SELECT,
      });
      const storedGuessed = guessedCategories(stored.scores_guessed);

      // A category keeps its old guess only while this write leaves it alone;
      // once covered, the write's own flag is the truth about it.
      const guessed = SCORE_CATEGORIES.filter((category) => {
        const written = scores[category];
        return written ? written.guessed : storedGuessed.includes(category);
      });

      const data: Record<string, number | string | Date | ScoreCategory[]> = {
        scored_at: scoredAt,
        scores_guessed: guessed,
      };
      for (const category of SCORE_CATEGORIES) {
        const written = scores[category];
        if (!written) continue;
        data[category] = written.score;
        data[`${category}_rationale`] = written.rationale;
      }

      const row = await db.company.update({
        where: { id },
        data,
        select: COMPANY_RECORD_SELECT,
      });
      return toCompanyRecord(row);
    },

    // Goes down before the search starts rather than after it answers, so a
    // run cut off partway reads differently from one never tried. It touches
    // nothing else, enriched_at included, because only a search that filled
    // a field in is allowed to close a company out.
    async startEnrichment(id) {
      const row = await db.company.update({
        where: { id },
        data: { enrichment_status: "pending" },
        select: COMPANY_RECORD_SELECT,
      });
      return toCompanyRecord(row);
    },

    // Writes the whole result of one search at once. A field the search did
    // not fill is written empty rather than left standing, because this is
    // the only thing that writes these and a later run must not read a value
    // this one did not find.
    //
    // There is no such thing as a permanently failed company. A search that
    // found nothing records that it found nothing and leaves enriched_at
    // empty, so the company is asked about again next time. The old code got
    // this wrong by accident: an empty result set marked a company done while
    // a service error left it retryable, and nobody chose that split.
    async saveEnrichment(id, found, doubts, at) {
      const answered = Boolean(found.address || found.phone || found.website);
      const row = await db.company.update({
        where: { id },
        data: {
          address: found.address ?? null,
          phone: found.phone ?? null,
          website: found.website ?? null,
          enrichment_flags: [...doubts],
          enrichment_uncertain: doubts.length > 0,
          enriched_at: answered ? at : null,
          enrichment_status: answered ? "complete" : "failed",
        },
        select: COMPANY_RECORD_SELECT,
      });
      return toCompanyRecord(row);
    },

    // Writes the whole score block exactly as the record holds it, empty
    // fields included. saveScores above merges a partial answer into what is
    // already stored; this one is for a caller that has already worked out
    // what every field should be, which is what backlog cleanup hands over
    // after emptying a stale judgement.
    async writeScores(company) {
      const row = await db.company.update({
        where: { id: company.id },
        data: {
          employee_satisfaction: company.employee_satisfaction,
          customer_satisfaction: company.customer_satisfaction,
          work_life_balance: company.work_life_balance,
          political_alignment: company.political_alignment,
          employee_satisfaction_rationale: company.employee_satisfaction_rationale,
          customer_satisfaction_rationale: company.customer_satisfaction_rationale,
          work_life_balance_rationale: company.work_life_balance_rationale,
          political_alignment_rationale: company.political_alignment_rationale,
          scored_at: company.scored_at,
          scores_guessed: company.scores_guessed,
        },
        select: COMPANY_RECORD_SELECT,
      });
      return toCompanyRecord(row);
    },
  };
}
