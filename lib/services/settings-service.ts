// A read-only view onto pipeline configuration. A collector reads its search
// terms, location, and ATS boards through here rather than querying the
// Setting and Company tables directly. A missing setting throws, so
// "nothing configured yet" never looks like "nothing to search for."
import type { createPipelineDb } from "../db/pipeline-db";
import { parsePriorityEntry } from "../utils/source-priority";

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
  getTitleHeadNouns(): Promise<string[]>;
  getTitleLevels(): Promise<TitleLevel[]>;
  getTitleSuffixes(): Promise<string[]>;
  getTitleRemovalWords(): Promise<string[]>;
  getSourcePriorityList(): Promise<string[]>;
  getIdentifyingQueryValues(): Promise<string[]>;
  getResolutionFastConcurrency(): Promise<number>;
  getResolutionSlowConcurrency(): Promise<number>;
  getResolutionSlowPauseSeconds(): Promise<number>;
  getRepostGapDays(): Promise<number>;
  getPromotionThreshold(): Promise<number>;
  getScoreExpiryDays(): Promise<number>;
  getGuessedScoreExpiryDays(): Promise<number>;
  getSearchTowns(): Promise<string[]>;
  getRemoteLabels(): Promise<string[]>;
  getExcludedTitles(): Promise<string[]>;
  getSearchWindowDays(): Promise<number>;
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
// empty list passes the shape check on purpose: an empty list is still a
// list, and refusing it is the job search's call, which it makes before
// running any source.
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

  // Shared by the text lists where an empty list is a real answer: read the
  // row, check the named column holds a list of strings, throw naming it
  // otherwise.
  async function getTextList(
    column: "search_terms" | "identifying_query_values" | "search_towns" | "remote_labels" | "excluded_titles"
  ): Promise<string[]> {
    const row = await getSettingsRow(db);
    const value = row === null ? null : row[column];
    if (!isStringArray(value)) {
      throw missingSettingError(column);
    }
    return value;
  }

  return {
    async getSearchTerms() {
      return getTextList("search_terms");
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

    async getIdentifyingQueryValues() {
      // An empty list is a real answer: it means no query value identifies a job.
      return getTextList("identifying_query_values");
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

    // Zero would flag every job carrying two dates as posted again, so it
    // cannot stand in for a gap nobody has set.
    async getRepostGapDays() {
      const row = await getSettingsRow(db);
      if (row === null || row.repost_gap_days === null) {
        throw missingSettingError("repost_gap_days");
      }
      return row.repost_gap_days;
    },

    async getPromotionThreshold() {
      const row = await getSettingsRow(db);
      if (row === null || row.promotion_threshold === null) {
        throw missingSettingError("promotion_threshold");
      }
      return row.promotion_threshold;
    },

    async getScoreExpiryDays() {
      const row = await getSettingsRow(db);
      if (row === null || row.score_expiry_days === null) {
        throw missingSettingError("score_expiry_days");
      }
      return row.score_expiry_days;
    },

    async getGuessedScoreExpiryDays() {
      const row = await getSettingsRow(db);
      if (row === null || row.guessed_score_expiry_days === null) {
        throw missingSettingError("guessed_score_expiry_days");
      }
      return row.guessed_score_expiry_days;
    },

    // An empty list is a real answer: it switches the local search off.
    async getSearchTowns() {
      return getTextList("search_towns");
    },

    // An empty list is a real answer: it switches the remote search off.
    async getRemoteLabels() {
      return getTextList("remote_labels");
    },

    // An empty list is a real answer: no title words are left out.
    async getExcludedTitles() {
      return getTextList("excluded_titles");
    },

    // Any stored number comes back; the search that reads it judges which are allowed.
    async getSearchWindowDays() {
      const row = await getSettingsRow(db);
      if (row === null || row.search_window_days === null) {
        throw missingSettingError("search_window_days");
      }
      return row.search_window_days;
    },
  };
}
