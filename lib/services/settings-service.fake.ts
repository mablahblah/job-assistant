// A complete stand-in SettingsService for tests. A test overrides only the
// getters it cares about, so the fake stays correct as the interface grows
// instead of going stale the way a hand-written stub would.
//
// Every getter with a real seeded default answers that default rather than an
// empty value, because zero is not a blank for any of these settings: a zero
// expiry threshold means every job is old enough to expire, a zero radius puts
// every job out of reach, and a zero lane width resolves nothing. A test that
// did not care about a setting used to be handed an instruction rather than a
// value.
import type { SettingsService } from "./settings-service";
import { SETTING_DEFAULTS } from "../db/setting-defaults";

export function fakeSettingsService(overrides: Partial<SettingsService> = {}): SettingsService {
  // The defaults come from the same file the seed fills the settings row from.
  // Each list is handed back as a copy, so a test that changes one cannot
  // change it for the next test.
  return {
    getSearchTerms: async () => [...SETTING_DEFAULTS.search_terms],
    getLocation: async () => SETTING_DEFAULTS.location,
    getRadius: async () => SETTING_DEFAULTS.radius,
    getExpiryThreshold: async () => SETTING_DEFAULTS.expiry_threshold,
    // The four title vocabularies stay empty rather than seeded: the tests that
    // use this fake were written against empty vocabularies.
    getTitleHeadNouns: async () => [],
    getTitleLevels: async () => [],
    getTitleSuffixes: async () => [],
    getTitleRemovalWords: async () => [],
    // The priority list has no seeded default to copy: it is built from the
    // collector registry rather than seeded as a constant.
    getSourcePriorityList: async () => [],
    getIdentifyingQueryValues: async () => [...SETTING_DEFAULTS.identifying_query_values],
    getResolutionFastConcurrency: async () => SETTING_DEFAULTS.resolution_fast_concurrency,
    getResolutionSlowConcurrency: async () => SETTING_DEFAULTS.resolution_slow_concurrency,
    getResolutionSlowPauseSeconds: async () => SETTING_DEFAULTS.resolution_slow_pause_seconds,
    getRepostGapDays: async () => SETTING_DEFAULTS.repost_gap_days,
    getPromotionThreshold: async () => SETTING_DEFAULTS.promotion_threshold,
    getScoreExpiryDays: async () => SETTING_DEFAULTS.score_expiry_days,
    getGuessedScoreExpiryDays: async () => SETTING_DEFAULTS.guessed_score_expiry_days,
    getSearchTowns: async () => [...SETTING_DEFAULTS.search_towns],
    getRemoteLabels: async () => [...SETTING_DEFAULTS.remote_labels],
    getExcludedTitles: async () => [...SETTING_DEFAULTS.excluded_titles],
    getSearchWindowDays: async () => SETTING_DEFAULTS.search_window_days,
    ...overrides,
  };
}
