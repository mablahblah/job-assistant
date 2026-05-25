// Validates the prefilter against all distinct location strings in the DB.
// Reports what action was taken for each location (passthrough, cleaned, split, skipped).
// No API calls — just prefilter logic.
// Run: npx tsx scripts/validate-prefilter.ts

import { prisma } from "../lib/prisma";
import { prefilterLocation } from "./spike-helpers/prefilter";

async function main() {
  const locations = await prisma.job.findMany({
    where: { location: { not: "" } },
    select: { location: true },
    distinct: ["location"],
    orderBy: { location: "asc" },
  });

  console.log(`\nPrefilter Validation — ${locations.length} distinct locations\n`);
  console.log(
    "Action".padEnd(14),
    "Input".padEnd(60),
    "Fragments"
  );
  console.log("─".repeat(140));

  // Counters per action
  const counts = { passthrough: 0, cleaned: 0, split: 0, skipped: 0 };

  for (const { location } of locations) {
    const result = prefilterLocation(location ?? "");
    counts[result.action]++;

    const fragmentStr =
      result.fragments.length === 0
        ? "(none)"
        : result.fragments.join(" | ");

    console.log(
      result.action.padEnd(14),
      (location ?? "(null)").padEnd(60),
      fragmentStr
    );
  }

  console.log("\n" + "─".repeat(140));
  console.log("\nSummary:");
  console.log(`  Passthrough: ${counts.passthrough}`);
  console.log(`  Cleaned:     ${counts.cleaned}`);
  console.log(`  Split:       ${counts.split}`);
  console.log(`  Skipped:     ${counts.skipped}`);
  console.log(`  Total:       ${locations.length}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
