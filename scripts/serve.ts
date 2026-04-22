// scripts/serve.ts
// Local web server — serves the read-only job dashboard
// Start: npx tsx scripts/serve.ts | Kill: Ctrl+C

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { prisma } from "../lib/prisma";
import { generateWeekSlots } from "../lib/work-search-weeks";
import { calculateScore } from "../lib/scoring";
import { renderPage } from "../lib/web/render";
import type { WebJob, WebWorkLogEntry } from "../lib/web/types";
import type { Company, Job } from "../lib/types";

const app = new Hono();

// Serve static CSS and JS files from public/
app.use("/styles/*", serveStatic({ root: "./public" }));
app.use("/scripts/*", serveStatic({ root: "./public" }));

// Single route: query all data, render the full page
app.get("/", async (c) => {
  // Run all four queries in parallel
  const [backlogRaw, activeRaw, disqualifiedRaw, workLogRaw] =
    await Promise.all([
      // Backlog: all jobs with status "backlog" — scored and sorted in JS below
      // Feature 1 (auto-expire) handles removing stale jobs — no date filter needed
      prisma.job.findMany({
        where: { status: "backlog" },
        include: { company: true },
      }),

      // Active: jobs in the application pipeline
      prisma.job.findMany({
        where: {
          status: {
            in: ["app. sent", "screening", "interview", "test", "offer"],
          },
        },
        include: { company: true },
        orderBy: { modifiedAt: "desc" },
      }),

      // Disqualified: jobs with terminal statuses (including reposts)
      prisma.job.findMany({
        where: {
          status: {
            in: ["expired", "too far", "rejected", "won't apply", "repost"],
          },
        },
        include: { company: true },
        orderBy: { modifiedAt: "desc" },
      }),

      // Work log: all entries with job + company relations
      prisma.workSearchEntry.findMany({
        include: {
          job: {
            include: {
              company: {
                select: {
                  name: true,
                  address: true,
                  phone: true,
                  website: true,
                  enrichmentStatus: true,
                },
              },
            },
          },
        },
        orderBy: { date: "desc" },
      }),
    ]);

  // Compute scores at request time — Prisma returns Date objects where Job type expects strings,
  // but calculateScore's ageModifier handles both via new Date()
  function addScores(rows: typeof backlogRaw): WebJob[] {
    return rows.map((r) => ({
      ...r,
      score: calculateScore(r as unknown as Job, r.company as unknown as Company),
    })) as unknown as WebJob[];
  }

  const backlog = addScores(backlogRaw).sort((a, b) => b.score - a.score);
  const active = addScores(activeRaw);
  const disqualified = addScores(disqualifiedRaw);

  // Convert work log dates to ISO strings for groupEntriesByWeek
  const workLogEntries: WebWorkLogEntry[] = workLogRaw.map((e) => ({
    id: e.id,
    date: e.date.toISOString(),
    activityType: e.activityType,
    result: e.result,
    job: {
      title: e.job.title,
      company: {
        name: e.job.company.name,
        address: e.job.company.address,
        phone: e.job.company.phone,
        website: e.job.company.website,
        enrichmentStatus: e.job.company.enrichmentStatus,
      },
    },
  }));

  // Generate week slots from earliest entry to now
  // workLogRaw is ordered date:desc, so last element is the oldest entry
  const earliest =
    workLogRaw.length > 0
      ? workLogRaw[workLogRaw.length - 1].date
      : new Date();
  const weekSlots = generateWeekSlots(earliest, new Date());

  const html = renderPage({
    backlog,
    active,
    disqualified,
    workLogEntries,
    weekSlots,
  });

  return c.html(html);
});

// Start the server
const port = 3000;
serve({ fetch: app.fetch, port }, () => {
  console.log(`\n  Dashboard → http://localhost:${port}\n`);
});
