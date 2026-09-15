// Owns every read and write of the AtsSlug table — the record that says a
// given ATS board slug belongs to a company, which parser reads its
// postings, and which collector, if any, polls it. Nothing else in the
// codebase touches AtsSlug directly, so the "one row per slug" rule and the
// "never overwrite a collector" rule live here rather than at each call
// site. There is deliberately no way to remove a row: nothing in this phase
// takes a board off a polling list, and offering the function anyway would
// invite a caller nobody designed for.
import type { createPipelineDb } from "../db/pipeline-db";
import { Prisma } from "../../generated/pipeline/client";

export interface AtsSlugRecord {
  id: string;
  slug: string;
  company_id: string;
  parser: string;
  collector: string | null;
}

export interface RecordInput {
  slug: string;
  company_id: string;
  parser: string;
}

export interface RecordResult {
  row: AtsSlugRecord;
  created: boolean;
}

export interface AtsSlugService {
  record(input: RecordInput): Promise<RecordResult>;
  findBySlug(slug: string): Promise<AtsSlugRecord | null>;
  addCollector(slug: string, collector: string): Promise<AtsSlugRecord | null>;
  listForCollector(collector: string): Promise<AtsSlugRecord[]>;
  listForCompany(companyId: string): Promise<AtsSlugRecord[]>;
}

type PipelineDb = ReturnType<typeof createPipelineDb>;

// Every read/write below selects exactly these columns, so the shape handed
// back always matches AtsSlugRecord regardless of what else the schema grows.
const SELECT = {
  id: true,
  slug: true,
  company_id: true,
  parser: true,
  collector: true,
} as const;

// True for a write the database refused because a unique column already
// holds the value — narrows the error type so its meta and constraint
// details are readable without a cast.
function isUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export function createAtsSlugService(db: PipelineDb): AtsSlugService {
  async function findBySlug(slug: string): Promise<AtsSlugRecord | null> {
    return db.atsSlug.findUnique({ where: { slug }, select: SELECT });
  }

  return {
    findBySlug,

    async record(input) {
      // The same slug turns up on posting after posting, so the common
      // second call is a hit here and never reaches the write below.
      const existing = await findBySlug(input.slug);
      if (existing) return { row: existing, created: false };

      try {
        const row = await db.atsSlug.create({
          // The collector is written as empty on purpose rather than left
          // off: recording a slug says only that we met this board on a
          // posting, never that anything polls it. Promotion fills it in.
          data: {
            slug: input.slug,
            company_id: input.company_id,
            parser: input.parser,
            collector: null,
          },
          select: SELECT,
        });
        return { row, created: true };
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        // Another write claimed the slug between the read and the create.
        // That row is the answer we would have found a moment earlier.
        const blocker = await findBySlug(input.slug);
        if (!blocker) throw error;
        return { row: blocker, created: false };
      }
    },

    async addCollector(slug, collector) {
      const existing = await findBySlug(slug);
      if (!existing) return null;
      // A board is polled by whichever collector claimed it first. A later
      // claim is ignored so a board never silently changes hands.
      if (existing.collector !== null) return existing;

      return db.atsSlug.update({
        where: { slug },
        data: { collector },
        select: SELECT,
      });
    },

    async listForCollector(collector) {
      return db.atsSlug.findMany({ where: { collector }, select: SELECT });
    },

    // Promotion needs every board one employer posts on, because filling a
    // row's collector in is what puts that employer on a polling list.
    async listForCompany(companyId) {
      return db.atsSlug.findMany({ where: { company_id: companyId }, select: SELECT });
    },
  };
}
