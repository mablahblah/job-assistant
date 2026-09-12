// The resolution queue comes out of the database grouped by collector, so
// every job from one website sits back to back. That is the order a website's
// rate limit punishes hardest: measured against Adzuna on 2026-09-12, roughly
// 25 page visits per five minutes passed and about 30 was refused. Dealing
// round-robin by host spreads each website's jobs across the whole run
// instead of hammering it in one burst.
//
// It names no website and holds no per-site rules. It only reads the host
// each job already carries on its own link.
import type { JobListEntry } from "./job-list-entry";

// A job's link can sit on a different subdomain of the same company than a
// sibling job — jobs.a.example against careers.a.example — and those two do
// not share a rate limiter. Grouping by host rather than by the owned domain
// matches how these sites actually throttle us.
function hostOf(originalUrl: string | null | undefined): string {
  if (!originalUrl) {
    return "\0no-host";
  }

  try {
    return new URL(originalUrl).host;
  } catch {
    // A link nobody can parse cannot be rate-limited by anyone, so it needs
    // no spreading out. It still has to come back, though: dropping it would
    // silently lose a job. It joins the other linkless jobs under a key no
    // real host can produce.
    return "\0no-host";
  }
}

export function interleaveByHost(jobs: JobListEntry[]): JobListEntry[] {
  // A Map keeps its keys in insertion order, which is what makes the deal
  // start from whichever host appeared first rather than from an arbitrary
  // one. Each group keeps arrival order inside itself for the same reason.
  const groups = new Map<string, JobListEntry[]>();
  for (const job of jobs) {
    const host = hostOf(job.original_url);
    const group = groups.get(host);
    if (group) {
      group.push(job);
    } else {
      groups.set(host, [job]);
    }
  }

  // One from each group in turn, skipping any that has run dry, so a host
  // with fewer jobs than the others leaves no gap and stops nothing. The
  // queues are this function's own arrays, so the list handed in is never
  // reordered underneath its caller.
  const dealt: JobListEntry[] = [];
  const queues = [...groups.values()];
  let remaining = jobs.length;
  while (remaining > 0) {
    for (const queue of queues) {
      const next = queue.shift();
      if (next) {
        dealt.push(next);
        remaining -= 1;
      }
    }
  }

  return dealt;
}
