/**
 * Test seed: 6 months of fake work search entries spread across ~26 weeks.
 * Run against a copy of dev.db — never against real data.
 *
 * Usage:
 *   cp prisma/dev.db prisma/dev.db.test
 *   DATABASE_URL="file:./dev.db.test" npx tsx prisma/seed-work-log.ts
 *   DATABASE_URL="file:./dev.db.test" npm run dev
 */

import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

const prisma = new PrismaClient({
  adapter: new PrismaLibSql({
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  }),
});

// Fake company pool
const COMPANIES = [
  { name: "Acme Design Co.", address: "123 Main St, Austin, TX 78701", phone: "(512) 555-0101", website: "https://acmedesign.com" },
  { name: "Bluebird Studio", address: "456 Oak Ave, San Francisco, CA 94107", phone: "(415) 555-0202", website: "https://bluebird.studio" },
  { name: "Cascade Systems", address: "789 Pine Rd, Seattle, WA 98101", phone: "(206) 555-0303", website: "https://cascadesys.com" },
  { name: "Drift UX", address: "321 Elm St, New York, NY 10001", phone: "(212) 555-0404", website: "https://driftux.com" },
  { name: "Echo Labs", address: "654 Maple Dr, Chicago, IL 60601", phone: "(312) 555-0505", website: "https://echolabs.io" },
  { name: "Frontier Digital", address: "987 Cedar Blvd, Denver, CO 80201", phone: "(720) 555-0606", website: "https://frontierdigital.com" },
  { name: "Grove Creative", address: "111 Birch Ln, Portland, OR 97201", phone: "(503) 555-0707", website: "https://grovecreative.co" },
  { name: "Harmon & Associates", address: "222 Walnut St, Boston, MA 02101", phone: "(617) 555-0808", website: "https://harmonassoc.com" },
  { name: "Inkwell Agency", address: "333 Spruce Ave, Atlanta, GA 30301", phone: "(404) 555-0909", website: "https://inkwellagency.com" },
  { name: "Juniper Software", address: "444 Ash St, Miami, FL 33101", phone: "(305) 555-1010", website: "https://junipersoftware.com" },
  { name: "Keystone UX", address: "555 Poplar Dr, Nashville, TN 37201", phone: "(615) 555-1111", website: "https://keystoneux.com" },
  { name: "Luminary Design", address: "666 Willow Rd, Minneapolis, MN 55401", phone: "(612) 555-1212", website: "https://luminarydesign.co" },
  { name: "Mosaic Labs", address: "777 Cypress Ct, Dallas, TX 75201", phone: "(214) 555-1313", website: "https://mosaiclabs.io" },
  { name: "Nexus Creative", address: "888 Redwood Way, Los Angeles, CA 90001", phone: "(310) 555-1414", website: "https://nexuscreative.com" },
  { name: "Orbit Design", address: "999 Magnolia Blvd, Houston, TX 77001", phone: "(713) 555-1515", website: "https://orbitdesign.com" },
];

const JOB_TITLES = [
  "Senior Product Designer",
  "Lead UX Designer",
  "Product Designer",
  "UX/UI Designer",
  "Principal Designer",
  "Design Systems Lead",
  "Senior UX Researcher",
  "Staff Product Designer",
];

const ACTIVITY_TYPES = ["Applied for job", "Had phone screen", "Had interview"] as const;

const RESULTS = [
  "Application filed",
  "Not hiring",
  "No response",
  "Moved forward",
  "Application under review",
];

// Returns the Sunday that starts the week containing `date`
function getWeekStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay()); // rewind to Sunday
  return d;
}

// Add `days` days to a date, return a new Date
function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// Pick a random element from an array
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function main() {
  const now = new Date("2026-04-07");
  const weekStart = getWeekStart(now);

  // Build 26 week-start Sundays going back from current week
  const weeks: Date[] = [];
  for (let i = 0; i < 26; i++) {
    weeks.push(addDays(weekStart, -7 * i));
  }

  // Create companies
  console.log("Creating companies...");
  const companies = await Promise.all(
    COMPANIES.map((c) =>
      prisma.company.upsert({
        where: { name: c.name },
        update: {},
        create: { ...c, enrichmentUncertain: Math.random() < 0.2 },
      })
    )
  );

  // Distribute entries across weeks — varying counts to exercise all UI states:
  // some weeks met (3+), some partial (1–2), some empty (~20%)
  const weekEntryCount = weeks.map((_) => {
    const rand = Math.random();
    if (rand < 0.2) return 0;         // empty week
    if (rand < 0.45) return 1;        // 1 entry — under quota
    if (rand < 0.6) return 2;         // 2 entries — under quota
    if (rand < 0.85) return 3;        // exactly 3 — met
    return Math.floor(Math.random() * 3) + 4; // 4–6 entries — over quota
  });

  let jobCounter = 0;

  for (let wi = 0; wi < weeks.length; wi++) {
    const count = weekEntryCount[wi];
    if (count === 0) continue;

    for (let ei = 0; ei < count; ei++) {
      // Pick a day within the week (Sun–Sat)
      const dayOffset = Math.floor(Math.random() * 7);
      const entryDate = addDays(weeks[wi], dayOffset);

      const company = pick(companies);
      const title = pick(JOB_TITLES);
      const activityType = pick([...ACTIVITY_TYPES]);
      const result = pick(RESULTS);

      // Create a unique fake job for each entry so data looks realistic
      const job = await prisma.job.create({
        data: {
          companyId: company.id,
          title,
          url: `https://jobs.example.com/fake-${++jobCounter}`,
          location: company.address ?? "Austin, TX",
          workMode: pick(["remote", "hybrid", "in-person"]),
          firstPublished: addDays(entryDate, -Math.floor(Math.random() * 14)),
          salaryRange: pick(["$120-$160k", "$140-$180k", "$160-$200k", "?"]),
          status: pick(["app. sent", "screening", "interview", "rejected"]),
          modifiedAt: entryDate,
        },
      });

      await prisma.workSearchEntry.create({
        data: {
          jobId: job.id,
          date: entryDate,
          activityType,
          result,
        },
      });
    }
  }

  const totalEntries = weekEntryCount.reduce((a, b) => a + b, 0);
  console.log(`Done. Created ${totalEntries} entries across ${weeks.length} weeks (${weeks.filter((_, i) => weekEntryCount[i] === 0).length} empty).`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
