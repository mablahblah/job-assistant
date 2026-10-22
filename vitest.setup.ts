import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { parse as parseEnvFile } from "dotenv";

const DATABASE_LINKS = ["PIPELINE_DATABASE_URL", "DATABASE_URL"];

const repoRoot = dirname(fileURLToPath(import.meta.url));
const envPath = join(repoRoot, ".env");

// Blank every outside-service key to prevent tests from loading real API keys.
if (existsSync(envPath)) {
  const envData = parseEnvFile(readFileSync(envPath));
  for (const key of Object.keys(envData)) {
    if (!DATABASE_LINKS.includes(key)) {
      process.env[key] = "";
    }
  }
}
