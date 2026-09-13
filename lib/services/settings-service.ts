// A read-only view onto pipeline configuration. A collector reads its search
// terms, location, and ATS boards through here rather than querying the
// Setting and Company tables directly. A missing setting throws, so
// "nothing configured yet" never looks like "nothing to search for."
import type { createPipelineDb } from "../db/pipeline-db";
import { parsePriorityEntry } from "../utils/source-priority";

// A board an ATS collector polls. The slug is the whole identity: the seed
// creates these companies with a slug and no name, and the three ATS
// collectors poll by slug, so a name here would have no reader.
export interface AtsCompany {
  ats_slug: string;
}

// One seniority spelling that gets stored, plus every spelling a posting
// might write for it, so `senior`, `sr` and `sr.` all end up as `Sr.`.
export interface TitleLevel {
  store: string;
  match: string[];
}

export interface SettingsService {
  getSearchTerms(): Promise<string[]>;
  getLocation(): Promise<string>;
  getRadius(): Promise<number>;
  getExpiryThreshold(): Promise<number>;
  getAtsCompanies(platform: string): Promise<AtsCompany[]>;
  getTitleHeadNouns(): Promise<string[]>;
  getTitleLevels(): Promise<TitleLevel[]>;
  getTitleSuffixes(): Promise<string[]>;
  getTitleRemovalWords(): Promise<string[]>;
  getSourcePriorityList(): Promise<string[]>;
  getResolutionFastConcurrency(): Promise<number>;
  getResolutionSlowConcurrency(): Promise<number>;
  getResolutionSlowPauseSeconds(): Promise<number>;
}

type PipelineDb = ReturnType<typeof createPipelineDb>;

// Every missing-setting error points at the seed as the fix, since that is
// the only thing that ever fills this row.
function missingSettingError(field: string): Error {
  return new Error(`Setting.${field} is missing. Run "npm run db:seed" to fill it.`);
}

// The getters below all read this same single row, so the fetch lives here
// once rather than once per column.
async function getSettingsRow(db: PipelineDb) {
  return db.setting.findUnique({ where: { id: 1 } });
}

// search_terms is a Prisma Json column, so its static type is JsonValue, not
// string[]. This checks the shape at runtime rather than trusting it. An
// empty list passes on purpose: emptying the search terms is how a search is
// switched off.
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

// A title vocabulary is a Json column too, but an empty one is not a way to
// switch anything off — a normalizer with no job nouns, suffixes or removal
// words to work from would quietly leave every title as it found it. So this
// rejects the empty list that isStringArray allows.
function isNonEmptyStringArray(value: unknown): value is string[] {
  return isStringArray(value) && value.length > 0;
}

// A level needs the spelling to store and at least one spelling to match. A
// level with nothing to match can never fire, so it counts as malformed
// rather than as a level that happens to do nothing.
function isTitleLevel(value: unknown): value is TitleLevel {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as { store?: unknown; match?: unknown };
  return typeof candidate.store === "string" && isNonEmptyStringArray(candidate.match);
}

function isTitleLevelArray(value: unknown): value is TitleLevel[] {
  return Array.isArray(value) && value.length > 0 && value.every(isTitleLevel);
}

// A priority list ranks every parser and collector in one flat order, so an
// empty list would rank nothing and leave every contest between two sources
// silently unresolved. Every entry has to parse as a real "kind:name"
// ranking, which parsePriorityEntry decides rather than a second copy of the
// rule here.
function isSourcePriorityList(value: unknown): value is string[] {
  return isNonEmptyStringArray(value) && value.every((entry) => parsePriorityEntry(entry) !== null);
}

export function createSettingsService(db: PipelineDb): SettingsService {
  // Shared by the three vocabularies that are plain word lists: read the row,
  // check the named column holds a non-empty list of strings, throw naming it
  // otherwise. title_levels holds objects instead, so it reads on its own.
  async function getWordVocabulary(
    column: "title_head_nouns" | "title_suffixes" | "title_removal_words"
  ): Promise<string[]> {
    const row = await getSettingsRow(db);
    const value = row === null ? null : row[column];
    if (!isNonEmptyStringArray(value)) {
      throw missingSettingError(column);
    }
    return value;
  }

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
        select: { ats_slug: true },
      });
      // The where clause already excludes null slugs, but ats_slug's static
      // type stays nullable. flatMap narrows it without a cast: a company
      // that somehow still has a null slug is dropped rather than trusted.
      return companies.flatMap((company) =>
        company.ats_slug === null ? [] : [{ ats_slug: company.ats_slug }]
      );
    },

    async getTitleHeadNouns() {
      return getWordVocabulary("title_head_nouns");
    },

    async getTitleLevels() {
      const row = await getSettingsRow(db);
      const value = row === null ? null : row.title_levels;
      if (!isTitleLevelArray(value)) {
        throw missingSettingError("title_levels");
      }
      return value;
    },

    async getTitleSuffixes() {
      return getWordVocabulary("title_suffixes");
    },

    async getTitleRemovalWords() {
      return getWordVocabulary("title_removal_words");
    },

    async getSourcePriorityList() {
      const row = await getSettingsRow(db);
      const value = row === null ? null : row.source_priority_list;
      if (!isSourcePriorityList(value)) {
        throw missingSettingError("source_priority_list");
      }
      return value;
    },

    // Zero is not a harmless stand-in for either lane's width: a lane
    // resolving no jobs at all looks like a lane that found none.
    async getResolutionFastConcurrency() {
      const row = await getSettingsRow(db);
      if (row === null || row.resolution_fast_concurrency === null) {
        throw missingSettingError("resolution_fast_concurrency");
      }
      return row.resolution_fast_concurrency;
    },

    async getResolutionSlowConcurrency() {
      const row = await getSettingsRow(db);
      if (row === null || row.resolution_slow_concurrency === null) {
        throw missingSettingError("resolution_slow_concurrency");
      }
      return row.resolution_slow_concurrency;
    },

    // Zero is a real answer here, meaning no pause at all, so it cannot be
    // read as absent the way an empty list or a zero width can.
    async getResolutionSlowPauseSeconds() {
      const row = await getSettingsRow(db);
      if (row === null || row.resolution_slow_pause_seconds === null) {
        throw missingSettingError("resolution_slow_pause_seconds");
      }
      return row.resolution_slow_pause_seconds;
    },
  };
}
