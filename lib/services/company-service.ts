// Owns every read and write of the Company table. Nothing else in the
// codebase talks to Company directly — callers go through the methods here
// so the name / match_key / slug uniqueness rules stay in one place instead
// of being re-solved at every call site.
import type { createPipelineDb } from "../db/pipeline-db";
import { Prisma } from "../../generated/pipeline/client";
import { companyMatchKey } from "../utils/company-match-key";

export interface CompanyRecord {
  id: string;
  name: string | null;
  match_key: string | null;
  ats_platform: string | null;
  ats_slug: string | null;
}

export interface CreateInput {
  name?: string | null;
  ats_platform?: string | null;
  ats_slug?: string | null;
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
  create(input: CreateInput): Promise<CreateResult>;
  fillName(id: string, name: string): Promise<FillNameResult>;
}

type PipelineDb = ReturnType<typeof createPipelineDb>;

// Every read/write below selects exactly these columns, so the shape handed
// back always matches CompanyRecord regardless of what else the schema grows.
const SELECT = {
  id: true,
  name: true,
  match_key: true,
  ats_platform: true,
  ats_slug: true,
} as const;

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
  async function findBySlug(slug: string): Promise<CompanyRecord | null> {
    return db.company.findUnique({ where: { ats_slug: slug }, select: SELECT });
  }

  async function findByMatchKey(matchKey: string): Promise<CompanyRecord | null> {
    return db.company.findUnique({ where: { match_key: matchKey }, select: SELECT });
  }

  async function findByName(name: string): Promise<CompanyRecord | null> {
    return db.company.findUnique({ where: { name }, select: SELECT });
  }

  // Used once a refusal names no column, or names one we wrote no value
  // for: check every value we tried to write in turn — whichever one is
  // already occupied is the blocker.
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

  // The column a refusal names is looked up directly, using the value we
  // tried to write there. Where it names none, or names a column we wrote no
  // value for — a slug on an update, for instance — every value we tried is
  // checked in turn instead.
  async function findBlocker(
    column: string | null,
    name: string | null,
    matchKey: string | null,
    slug: string | null
  ): Promise<CompanyRecord | null> {
    if (column === "name" && name) return findByName(name);
    if (column === "match_key" && matchKey) return findByMatchKey(matchKey);
    if (column === "ats_slug" && slug) return findBySlug(slug);
    return findConflict(name, matchKey, slug);
  }

  return {
    findBySlug,
    findByMatchKey,

    async create(input) {
      // An empty-string name is treated as no name — a caller passing ""
      // almost certainly forgot to fill it in, not deliberately asking for
      // a nameless company by another name.
      const trimmedName = input.name?.trim();
      const name = trimmedName ? trimmedName : null;
      if (!name && !input.ats_slug) {
        throw new Error("Company.create requires either a name or a slug to identify the company.");
      }
      const match_key = name ? companyMatchKey(name) : null;
      const ats_slug = input.ats_slug ?? null;

      try {
        const company = await db.company.create({
          data: {
            name,
            match_key,
            ats_platform: input.ats_platform ?? null,
            ats_slug,
          },
          select: SELECT,
        });
        return { company, created: true };
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        // Another company already holds this name, this match key, or this
        // slug — two job postings for the same employer, not a real failure.
        const blocker = await findBlocker(columnFromRefusal(error), name, match_key, ats_slug);
        if (!blocker) throw error;
        return { company: blocker, created: false };
      }
    },

    async fillName(id, name) {
      const match_key = companyMatchKey(name);
      try {
        const company = await db.company.update({
          where: { id },
          data: { name, match_key },
          select: SELECT,
        });
        return { company, filled: true, heldBy: null };
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        // Someone else already has this name — two spellings of one
        // employer. Leave the target company as it was and hand back
        // whoever is already holding the name, instead of writing over it.
        // An update never writes a slug, so a slug is never its blocker.
        const [company, heldBy] = await Promise.all([
          db.company.findUniqueOrThrow({ where: { id }, select: SELECT }),
          findBlocker(columnFromRefusal(error), name, match_key, null),
        ]);
        return { company, filled: false, heldBy };
      }
    },
  };
}
