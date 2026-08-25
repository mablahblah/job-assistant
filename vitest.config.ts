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
    // legacy/ is the quarantined old pipeline; docs/ holds research spikes.
    // Neither is part of the new pipeline's test suite.
    exclude: ["**/node_modules/**", "legacy/**", "docs/**"],
    // No tests yet — the new pipeline suite lands with its first loop.
    passWithNoTests: true,
    // Fix timezone-dependent tests: getWeekStart uses local time, test fixtures use UTC dates
    env: { TZ: "UTC" },
  },
});
