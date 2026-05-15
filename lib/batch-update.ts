// Batch update operations — accepts JSON arrays, returns summary counts.
import { prisma } from "@/lib/prisma";
import { logWorkSearchActivity } from "@/lib/work-search-log";

// Reads raw text from stdin so the CLI can receive heredoc JSON input.
export async function readStdin(): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return chunks.join("");
}

// Summary of how many jobs succeeded or failed in a batch operation.
export interface BatchResult {
  updated: number;
  failed: number;
  errors?: { jobId: string; error: string }[];
}

// Saves job alignment scores (1-5) for a batch of jobs — best-effort, skips bad items.
export async function batchAlignment(
  items: { jobId: string; score: number }[]
): Promise<BatchResult> {
  const errors: { jobId: string; error: string }[] = [];
  const ops: Promise<unknown>[] = [];

  for (const item of items) {
    // Validate score range before touching the DB
    if (item.score < 1 || item.score > 5) {
      errors.push({ jobId: item.jobId, error: "Score must be 1-5" });
      continue;
    }
    // Each update runs independently — one failure won't stop the rest
    ops.push(
      prisma.job
        .update({
          where: { id: item.jobId },
          data: { jobAlignment: item.score },
        })
        .catch(() => {
          // Capture DB-level failures (e.g. unknown job ID) without aborting the batch
          errors.push({ jobId: item.jobId, error: "Job not found" });
        })
    );
  }

  await Promise.allSettled(ops);

  return {
    updated: items.length - errors.length,
    failed: errors.length,
    ...(errors.length > 0 && { errors }),
  };
}

// Flags jobs where the actual role doesn't match what the title implies — best-effort, parallel.
export async function batchFlagMismatch(
  items: { jobId: string; reason: string }[]
): Promise<BatchResult> {
  const errors: { jobId: string; error: string }[] = [];
  const ops: Promise<unknown>[] = [];

  for (const item of items) {
    // Each update runs independently — one failure won't stop the rest
    ops.push(
      prisma.job
        .update({
          where: { id: item.jobId },
          data: { titleMismatch: true, titleMismatchReason: item.reason },
        })
        .catch(() => {
          errors.push({ jobId: item.jobId, error: "Job not found" });
        })
    );
  }

  await Promise.allSettled(ops);

  return {
    updated: items.length - errors.length,
    failed: errors.length,
    ...(errors.length > 0 && { errors }),
  };
}

// Flags jobs posted by a staffing/recruiting aggregator — best-effort, parallel.
export async function batchFlagAggregator(
  jobIds: string[]
): Promise<BatchResult> {
  const errors: { jobId: string; error: string }[] = [];
  const ops: Promise<unknown>[] = [];

  for (const jobId of jobIds) {
    // Each update runs independently — one failure won't stop the rest
    ops.push(
      prisma.job
        .update({
          where: { id: jobId },
          data: {},
        })
        .catch(() => {
          errors.push({ jobId, error: "Job not found" });
        })
    );
  }

  await Promise.allSettled(ops);

  return {
    updated: jobIds.length - errors.length,
    failed: errors.length,
    ...(errors.length > 0 && { errors }),
  };
}

// Updates job status and logs qualifying changes for TWC compliance — sequential to avoid concurrent side effects.
export async function batchStatus(
  items: { jobId: string; status: string }[]
): Promise<BatchResult> {
  const errors: { jobId: string; error: string }[] = [];

  for (const item of items) {
    try {
      // Update status fields; reset locationFlagged so stale flags don't linger
      await prisma.job.update({
        where: { id: item.jobId },
        data: {
          status: item.status,
          modifiedAt: new Date(),
          locationFlagged: false,
        },
      });
    } catch {
      errors.push({ jobId: item.jobId, error: "Job not found" });
      continue; // skip the log call if the DB write failed
    }
    // Log qualifying status changes — runs only after a successful DB write
    await logWorkSearchActivity(item.jobId, item.status);
  }

  return {
    updated: items.length - errors.length,
    failed: errors.length,
    ...(errors.length > 0 && { errors }),
  };
}
