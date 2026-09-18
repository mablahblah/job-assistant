// The phrase sent to the paid search service when looking up an employer's
// contact details.
//
// A common employer name finds the wrong business on its own, so the place
// narrows the search. The old code put the job's own location text into the
// query and had to filter "Remote" and blanks out of it itself. The new job
// record holds the one place that matched the user's acceptable distance,
// which is already a real place, so no such filter belongs here.
//
// A job moved straight out of the backlog was never classified and carries no
// matched place, so the name stands alone. The old code did the same for a
// remote job.

// Ported unchanged. It is what tells the search we want an office rather than
// the company's news coverage.
const WHAT_WE_WANT = "headquarters address, phone number, domain url";

export function queryFromCompany(companyName: string, place?: string | null): string {
  const name = companyName.trim();
  const matched = place?.trim();

  // Trimmed on both sides, because the query is paid for.
  const wherePart = matched ? ` ${matched}` : "";

  return `${name}${wherePart} ${WHAT_WE_WANT}`;
}
