// A complete stand-in SettingsService for tests, with every getter resolving
// to a harmless empty value. A test overrides only the getters it cares
// about, so the fake stays correct as the interface grows instead of going
// stale the way a hand-written stub would.
import type { SettingsService } from "./settings-service";

export function fakeSettings(overrides: Partial<SettingsService> = {}): SettingsService {
  return {
    getSearchTerms: async () => [],
    getLocation: async () => "",
    getRadius: async () => 0,
    getExpiryThreshold: async () => 0,
    getAtsCompanies: async () => [],
    getTitleHeadNouns: async () => [],
    getTitleLevels: async () => [],
    getTitleSuffixes: async () => [],
    getTitleRemovalWords: async () => [],
    getSourcePriorityList: async () => [],
    ...overrides,
  };
}
