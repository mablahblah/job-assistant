// Standalone script to validate Adzuna collector data accuracy.
// Collects jobs from the Adzuna API, then outputs a table for manual comparison
// against the actual job pages. Run with: npx tsx scripts/validate-adzuna.ts

import "dotenv/config";
import { collectAdzuna } from "../lib/collectors/adzuna";
import { compareFields } from "../lib/parsers/confidence";
import type { ParsedFields } from "../lib/parsers/types";

async function main() {
  const jobs = await collectAdzuna({ titleOnly: "Product Design" });
  console.log(`\nCollected ${jobs.length} Adzuna jobs\n`);

  for (const job of jobs) {
    // Build collector fields in ParsedFields shape
    const collectorFields: Partial<ParsedFields> = {
      title: job.title || undefined,
      companyName: job.companyName || undefined,
      location: job.location || undefined,
      workMode: job.workMode || undefined,
      // dates excluded — they flow through resolveJobDates, not confidence comparison
      salaryRange: job.salaryRange || undefined,
    };

    // Pass-through: empty parser fields → all medium confidence
    const confidence = compareFields({}, collectorFields);

    console.log("─".repeat(80));
    console.log(`URL:     ${job.url}`);
    console.log(`Title:   ${job.title}`);
    console.log(`Company: ${job.companyName}`);
    console.log(`Posted:  ${job.dates?.[0]?.toISOString().slice(0, 10) ?? "(none)"}`);
    console.log(`Loc:     ${job.location}`);
    console.log(`Mode:    ${job.workMode}`);
    console.log(`Salary:  ${job.salaryRange}`);
    console.log(`Confidence: ${confidence.map((c) => `${c.field}=${c.confidence}`).join(", ")}`);
    console.log();
  }

  console.log("─".repeat(80));
  console.log("\nManual check: open each URL above in a browser and compare");
  console.log("company name and posted date against what the actual page shows.\n");
}

main().catch(console.error);
