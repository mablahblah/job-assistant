import { COLLECTOR_CONFIG, SEARCH_TERMS } from "./collector-config";
import { collectAdzuna } from "./adzuna";
import { collectJSearch } from "./jsearch";
import { collectGreenhouseCompany } from "./greenhouse";
import { collectLeverCompany } from "./lever";
import { collectDribbble } from "./dribbble";
import { collectWeLoveProduct } from "./weloveproduct";
import { collectUiUxJobsBoard } from "./uiuxjobsboard";
import type { CollectedJob, CollectorResult } from "./types";

export interface CollectAllResult {
  jobs: CollectedJob[];
  results: CollectorResult[];
}

// Runs all enabled collectors and combines their output into one list.
export async function collectAll(): Promise<CollectAllResult> {
  const config = COLLECTOR_CONFIG;
  const queries = [...SEARCH_TERMS];
  const results: CollectorResult[] = [];

  // Build the list of collector tasks to run
  const tasks: Array<{ source: string; fn: () => Promise<CollectedJob[]> }> = [];

  if (config.adzuna.enabled) {
    // Join exclude terms into a space-separated string for the API
    const whatExclude = config.adzuna.excludeTerms?.join(" ") || undefined;
    for (const query of queries) {
      // Remote: find jobs mentioning "remote" with the search term in the title
      tasks.push({
        source: "adzuna",
        fn: () => collectAdzuna({ titleOnly: query, what: "remote", whatExclude }),
      });
      // Austin: find local jobs with the search term in the title
      tasks.push({
        source: "adzuna",
        fn: () => collectAdzuna({ titleOnly: query, where: "78701", distance: "15", whatExclude }),
      });
    }
  }

  if (config.jsearch.enabled) {
    const combined = queries.join(" OR ");
    tasks.push({
      source: "jsearch",
      fn: async () => {
        // Two parallel searches: remote jobs + Austin-area jobs
        const [remote, austin] = await Promise.allSettled([
          collectJSearch({ query: `remote ${combined} jobs`, workFromHome: true }),
          collectJSearch({ query: `${combined} jobs in Austin`, location: "Austin, United States" }),
        ]);
        return [
          ...(remote.status === "fulfilled" ? remote.value : []),
          ...(austin.status === "fulfilled" ? austin.value : []),
        ];
      },
    });
  }

  if (config.greenhouse.enabled) {
    for (const slug of config.greenhouse.slugs) {
      tasks.push({ source: "greenhouse", fn: () => collectGreenhouseCompany(slug, queries) });
    }
  }

  if (config.lever.enabled) {
    for (const slug of config.lever.slugs) {
      tasks.push({ source: "lever", fn: () => collectLeverCompany(slug, queries) });
    }
  }

  if (config.dribbble.enabled) {
    tasks.push({ source: "dribbble", fn: () => collectDribbble(queries) });
  }

  if (config.weloveproduct.enabled) {
    tasks.push({ source: "weloveproduct", fn: () => collectWeLoveProduct(queries) });
  }

  if (config.uiuxjobsboard.enabled) {
    tasks.push({ source: "uiuxjobsboard", fn: () => collectUiUxJobsBoard(queries) });
  }

  // Run each task sequentially, capturing errors without stopping the pipeline
  const allJobs: CollectedJob[] = [];

  for (const task of tasks) {
    console.error(`[collect] Running ${task.source}...`);
    try {
      const jobs = await task.fn();
      allJobs.push(...jobs);
      results.push({ source: task.source, jobs });
      console.error(`[collect] ${task.source}: found=${jobs.length}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      results.push({ source: task.source, jobs: [], error: msg });
      console.error(`[collect] ${task.source} failed: ${msg}`);
    }
  }

  return { jobs: allJobs, results };
}
