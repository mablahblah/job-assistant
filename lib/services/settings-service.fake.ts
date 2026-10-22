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

export function fakeSettingsService(overrides: Partial<SettingsService> = {}): SettingsService {
  // Copied from SETTING_DEFAULTS in scripts/db-seed.ts, which cannot be
  // imported here because that script runs its seeder at import time. The two
  // move together: changing one means changing the other.
  return {
    getSearchTerms: async () => ["Product Design", "UX", "Founding Design"],
    getLocation: async () => "78701",
    getRadius: async () => 30,
    getExpiryThreshold: async () => 8,
    // The four title vocabularies stay empty. Their seeded values are long
    // lists already hand-copied into two other test files, so a third copy
    // here would make drift more likely rather than less.
    getTitleHeadNouns: async () => [],
    getTitleLevels: async () => [],
    getTitleSuffixes: async () => [],
    getTitleRemovalWords: async () => [],
    // The priority list has no seeded default to copy: it is built from the
    // collector registry rather than seeded as a constant.
    getSourcePriorityList: async () => [],
    // Copied from scripts/db-seed.ts, which seeds the identifying query values.
    getIdentifyingQueryValues: async () => ["opportunityid", "reqId", "gh_jid"],
    getResolutionFastConcurrency: async () => 3,
    getResolutionSlowConcurrency: async () => 1,
    getResolutionSlowPauseSeconds: async () => 12,
    getRepostGapDays: async () => 3,
    getPromotionThreshold: async () => 3.5,
    getScoreExpiryDays: async () => 90,
    getGuessedScoreExpiryDays: async () => 30,
    getSearchTowns: async () => [
      "Austin, Texas, United States",
      "Round Rock, Texas, United States",
      "Cedar Park, Texas, United States",
      "Pflugerville, Texas, United States",
      "Georgetown, Texas, United States",
      "Leander, Texas, United States",
      "Kyle, Texas, United States",
      "Buda, Texas, United States",
      "San Marcos, Texas, United States",
      "Hutto, Texas, United States",
      "Manor, Texas, United States",
      "Lakeway, Texas, United States",
      "Bee Cave, Texas, United States",
      "Dripping Springs, Texas, United States",
      "Taylor, Texas, United States",
      "Bastrop, Texas, United States",
    ],
    getRemoteLabels: async () => ["Remote OK", "Remote Solely"],
    getExcludedTitles: async () => [
      "Engineer",
      "Engineering",
      "Research",
      "Researcher",
      "Associate",
      "Junior",
      "Jr",
      "Intern",
      "Internship",
      "Director",
      "Head",
      "VP",
      "Manager",
    ],
    getSearchWindowDays: async () => 7,
    ...overrides,
  };
}
