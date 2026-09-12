// The lines a command prints when a run finishes, built from the run's trace
// rows rather than from what the run hands back. The return value carries list
// lengths alone: it cannot say how many jobs came from adzuna rather than
// lever, or how many duplicates were reposts rather than jobs already saved.
// Every number broken out by collector or by reason exists only in the trace
// rows, so this reads those and turns one run's worth of them into text.
import type { TraceRunCount } from "./trace-service";

// One pass, shared by every block below, because each number this file needs
// is the same question asked with different values: how many rows match this
// combination of step, event and reason.
function total(counts: TraceRunCount[], matches: (row: TraceRunCount) => boolean): number {
  return counts.reduce((sum, row) => (matches(row) ? sum + row.count : sum), 0);
}

export function summaryFromTraceCounts(
  counts: TraceRunCount[],
  collectors: string[]
): string[] {
  const lines: string[] = [];

  // A headline number, printed even at zero, because a run that collected
  // nothing is exactly what the reader needs told rather than left to infer
  // from a missing line.
  const collected = total(counts, (row) => row.step === "collection" && row.event === "collected");
  lines.push(`Collected: ${collected} jobs`);

  // Every collector gets a line, in the order the run was given them, even
  // one that found nothing. A collector that collected zero writes no trace
  // row at all, so leaving it out would read as "we did not run it" when the
  // truth is "this source went quiet".
  for (const collector of collectors) {
    const found = total(
      counts,
      (row) =>
        row.step === "collection" && row.event === "collected" && row.collector === collector
    );
    lines.push(`  - ${collector} collected ${found} jobs`);
  }

  // `collector_provided` is written when an ATS board or Dribbble hands over a
  // job already pointing at the employer's own page. It is recorded at
  // collection rather than worked out here, because jobs saved minus jobs
  // resolved counts two different populations: resolution reads its list from
  // the database, so it also processes jobs an earlier run collected.
  const alreadyResolved = total(
    counts,
    (row) =>
      row.step === "collection" &&
      row.event === "job_resolved" &&
      row.reason === "collector_provided"
  );
  if (alreadyResolved > 0) {
    lines.push(`  - ${alreadyResolved} jobs already had a source link`);
  }

  // Two reasons both mean the duplicate was found inside this run's own list,
  // before anything was compared against the database.
  const duplicatesInList = total(
    counts,
    (row) =>
      row.step === "post_collection_dedupe" &&
      row.event === "abandoned" &&
      (row.reason === "hard_match_in_list" || row.reason === "repost_match_in_list")
  );
  // `matched_db_row` is the one reason meaning the duplicate was found against
  // a row saved by an earlier run rather than against this run's own list.
  const duplicatesAlreadySaved = total(
    counts,
    (row) =>
      row.step === "post_collection_dedupe" &&
      row.event === "abandoned" &&
      row.reason === "matched_db_row"
  );
  // The heading goes with its lines. A heading standing alone over nothing
  // only asks the reader what happened.
  if (duplicatesInList > 0 || duplicatesAlreadySaved > 0) {
    lines.push("Dedupe (post collection)");
    if (duplicatesInList > 0) {
      lines.push(`  - ${duplicatesInList} jobs were duplicates from this collection`);
    }
    if (duplicatesAlreadySaved > 0) {
      lines.push(`  - ${duplicatesAlreadySaved} jobs were duplicates of jobs already saved`);
    }
  }

  // The step filter carries weight here: collection writes `job_resolved` too,
  // for jobs a collector resolved itself. Those are counted above, and
  // counting them again here would credit resolution with work it never did.
  const resolved = total(counts, (row) => row.step === "resolution" && row.event === "job_resolved");
  lines.push(`Resolved: ${resolved} jobs`);

  const failed = total(
    counts,
    (row) => row.step === "resolution" && row.event === "resolution_failed"
  );
  if (failed > 0) {
    lines.push(`  - ${failed} jobs could not be resolved`);
  }

  return lines;
}
