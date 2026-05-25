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
    // Fix timezone-dependent tests: getWeekStart uses local time, test fixtures use UTC dates
    env: { TZ: "UTC" },
  },
});
