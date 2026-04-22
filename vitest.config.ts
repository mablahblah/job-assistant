import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    // Fix timezone-dependent tests: getWeekStart uses local time, test fixtures use UTC dates
    env: { TZ: "UTC" },
  },
});
