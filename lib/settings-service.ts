// A read-only view onto pipeline configuration. A collector reads its search
// terms, location, and ATS boards through here rather than querying the
// Setting and Company tables directly. A missing setting throws, so
// "nothing configured yet" never looks like "nothing to search for."
import type { createPipelineDb } from "./pipeline-db";

export interface AtsCompany {
  name: string;
  ats_slug: string;
}

export interface SettingsService {
  getSearchTerms(): Promise<string[]>;
  getLocation(): Promise<string>;
  getRadius(): Promise<number>;
  getExpiryThreshold(): Promise<number>;
  getAtsCompanies(platform: string): Promise<AtsCompany[]>;
}

type PipelineDb = ReturnType<typeof createPipelineDb>;

// Every missing-setting error points at the seed as the fix, since that is
// the only thing that ever fills this row.
function missingSettingError(field: string): Error {
  return new Error(`Setting.${field} is missing. Run "npm run db:seed" to fill it.`);
}

// The four getters below all read this same single row, so the fetch lives
// here once rather than four times.
async function getSettingsRow(db: PipelineDb) {
  return db.setting.findUnique({ where: { id: 1 } });
}

// search_terms is a Prisma Json column, so its static type is JsonValue, not
// string[]. This checks the shape at runtime rather than trusting it.
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function createSettingsService(db: PipelineDb): SettingsService {
  return {
    async getSearchTerms() {
      const row = await getSettingsRow(db);
      if (row === null || !isStringArray(row.search_terms)) {
        throw missingSettingError("search_terms");
      }
      return row.search_terms;
    },

    async getLocation() {
      const row = await getSettingsRow(db);
      if (row === null || row.location === null) {
        throw missingSettingError("location");
      }
      return row.location;
    },

    async getRadius() {
      const row = await getSettingsRow(db);
      if (row === null || row.radius === null) {
        throw missingSettingError("radius");
      }
      return row.radius;
    },

    async getExpiryThreshold() {
      const row = await getSettingsRow(db);
      if (row === null || row.expiry_threshold === null) {
        throw missingSettingError("expiry_threshold");
      }
      return row.expiry_threshold;
    },

    // A platform with no boards returns an empty list rather than throwing,
    // because emptying a platform is how it is switched off.
    async getAtsCompanies(platform: string) {
      const companies = await db.company.findMany({
        where: { ats_platform: platform, ats_slug: { not: null } },
        select: { name: true, ats_slug: true },
      });
      // The where clause already excludes null slugs, but ats_slug's static
      // type stays nullable. flatMap narrows it without a cast: a company
      // that somehow still has a null slug is dropped rather than trusted.
      return companies.flatMap((company) =>
        company.ats_slug === null ? [] : [{ name: company.name, ats_slug: company.ats_slug }]
      );
    },
  };
}
