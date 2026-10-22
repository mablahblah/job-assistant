import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parse as parseEnvFile } from "dotenv";
import { describe, expect, test } from "vitest";

const repoRoot = dirname(fileURLToPath(import.meta.url));
const envPath = join(repoRoot, ".env");

// The two database links stay as .env has them: every test points its own
// command at a scratch database, and neither reaches a service outside the app.
const DATABASE_LINKS = ["PIPELINE_DATABASE_URL", "DATABASE_URL"];

// One spawn of npx tsx, which costs a few seconds before the command itself
// starts. A ceiling rather than a budget.
const RUN_TIMEOUT_MS = 60_000;

const outsideServiceKeys = existsSync(envPath)
  ? Object.keys(parseEnvFile(readFileSync(envPath))).filter((key) => !DATABASE_LINKS.includes(key))
  : [];

// A fresh clone has no .env, so no real key exists for a test to leak.
describe.skipIf(outsideServiceKeys.length === 0)("no test holds a real outside-service key", () => {
  test("every key .env holds, other than the database links, is empty inside a test", () => {
    for (const key of outsideServiceKeys) expect(process.env[key] === "", key).toBe(true);
  });

  // The measured leak: a test handed its command { ...process.env }, and the
  // command's own .env loading put the real key back. Only whether each key is
  // empty is printed or compared, so a failure never shows a real key.
  test(
    "a command a test starts still finds every such key empty after loading .env",
    () => {
      const code = [
        'require("./lib/db/pipeline-db");',
        `const keys = ${JSON.stringify(outsideServiceKeys)};`,
        "console.log(JSON.stringify(Object.fromEntries(keys.map((key) => [key, process.env[key] === \"\"]))));",
      ].join("\n");

      const output = execFileSync("npx", ["tsx", "-e", code], {
        cwd: repoRoot,
        env: { ...process.env },
        encoding: "utf8",
      });

      const seen = JSON.parse(output.trim().split("\n").at(-1) ?? "{}") as Record<string, unknown>;
      for (const key of outsideServiceKeys) expect(seen[key], key).toBe(true);
    },
    RUN_TIMEOUT_MS
  );
});
