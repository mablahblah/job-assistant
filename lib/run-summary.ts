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

// English disagrees with a bare plural at one, and a summary the user reads
// every run is the wrong place to make them forgive it. Zero keeps the plural,
// because zero jobs is not one job.
function jobs(n: number): string {
  return n === 1 ? "1 job" : `${n} jobs`;
}

// Two detail lines carry a verb that has to agree as well, so they cannot be
// built from the count alone.
function wasOrWere(n: number): string {
  return n === 1 ? "was a duplicate" : "were duplicates";
}

// A domain either has a parser or it does not, so its rows can never disagree
// about which of the two labels it earns. The one mix that can happen is a
// parser that threw on one job and read nothing on another, and both of those
// mean the same thing to a reader: the parser ran and came back empty.
function failureLabelFromReason(reason: string | null): string {
  return reason === "no_parser_for_domain" ? "no parser" : "parser failed";
}

// Grouped apart from the failure total, because the total counts every failed
// parse while this lists only the ones pointing somewhere fixable.
function topFailedDomains(
  counts: TraceRunCount[]
): { domain: string; count: number; label: string }[] {
  const byDomain = new Map<string, { count: number; label: string }>();

  for (const row of counts) {
    // A link that yields no owned domain still owes its count to the total
    // above, but there is nothing to name it by, so it has no line here.
    if (row.step !== "parsing" || row.event !== "parse_failed" || row.domain === null) {
      continue;
    }

    const existing = byDomain.get(row.domain);
    if (existing) {
      existing.count += row.count;
    } else {
      byDomain.set(row.domain, { count: row.count, label: failureLabelFromReason(row.reason) });
    }
  }

  return Array.from(byDomain.entries())
    .map(([domain, { count, label }]) => ({ domain, count, label }))
    // Highest cost first, because the block exists to say which parser is
    // worth building next, and that is the domain losing the most jobs. Ties
    // fall back to the domain name so the list is stable between runs rather
    // than shuffling with whatever order the rows arrived in.
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain))
    // Five, and nothing counting what was left out. The failed total prints
    // directly above, so five domains not adding up to it already read as a
    // sample, and every domain dropped here still has its trace rows.
    .slice(0, 5);
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
  lines.push(`Collected: ${jobs(collected)}`);

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
    lines.push(`  - ${collector} collected ${jobs(found)}`);
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
    lines.push(`  - ${jobs(alreadyResolved)} already had a source link`);
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
      lines.push(`  - ${jobs(duplicatesInList)} ${wasOrWere(duplicatesInList)} from this collection`);
    }
    if (duplicatesAlreadySaved > 0) {
      lines.push(
        `  - ${jobs(duplicatesAlreadySaved)} ${wasOrWere(duplicatesAlreadySaved)} of ${
          duplicatesAlreadySaved === 1 ? "a job" : "jobs"
        } already saved`
      );
    }
  }

  // The step filter carries weight here: collection writes `job_resolved` too,
  // for jobs a collector resolved itself. Those are counted above, and
  // counting them again here would credit resolution with work it never did.
  const resolved = total(counts, (row) => row.step === "resolution" && row.event === "job_resolved");
  lines.push(`Resolved: ${jobs(resolved)}`);

  const failed = total(
    counts,
    (row) => row.step === "resolution" && row.event === "resolution_failed"
  );
  if (failed > 0) {
    lines.push(`  - ${jobs(failed)} could not be resolved`);
  }

  const parsed = total(counts, (row) => row.step === "parsing" && row.event === "job_parsed");
  lines.push(`Parsed: ${jobs(parsed)}`);

  // The failing domains hang off this line rather than standing on their own,
  // because a domain list with no total above it cannot say whether five
  // domains are all of them or the worst of them.
  const parseFailures = total(
    counts,
    (row) => row.step === "parsing" && row.event === "parse_failed"
  );
  if (parseFailures > 0) {
    lines.push(`  - ${jobs(parseFailures)} could not be parsed`);

    for (const { domain, count, label } of topFailedDomains(counts)) {
      lines.push(`    - ${domain}: ${jobs(count)} (${label})`);
    }
  }

  return lines;
}
