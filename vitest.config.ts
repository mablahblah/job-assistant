import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Mirror tsconfig "paths" so non-mocked @/ imports resolve in tests
      "@": path.resolve(__dirname),
    },
  },
  test: {
    include: ["**/*.test.ts"],
    // docs/ holds research spikes, not app code.
    exclude: ["**/node_modules/**", "docs/**"],
    // Kept from when the suite was empty: a filter matching no test file passes.
    passWithNoTests: true,
    // Fix timezone-dependent tests: getWeekStart uses local time, test fixtures use UTC dates
    env: { TZ: "UTC" },
  },
});
