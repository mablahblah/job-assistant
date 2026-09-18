// The doubts a search raised about the contact details it filled in. They are
// shown to the user so a detail worth checking is checked before the filing
// rather than after it.
//
// Measured against the live search service, two of six employers yielded no
// contact details at all, so a search raising doubts is an ordinary outcome
// rather than an edge case.
//
// The old code raised a third doubt, about a result naming a different
// company. It cannot fire any more: no unmatched result is ever read.

// The filing is a Texas one, so an address the reader took off a result about
// a foreign office is worth a second look. Ported unchanged.
const US_ADDRESS = /\b[A-Z]{2}\s+\d{5}|\bUnited States\b/i;

// Named as one list, so the company service can narrow the Json column these
// are stored in without retyping them. The type is derived from the list
// rather than written beside it, so the two cannot drift apart.
export const ENRICHMENT_DOUBTS = [
  "address_outside_us",
  "missing_address",
  "missing_phone",
] as const;

export type EnrichmentDoubt = (typeof ENRICHMENT_DOUBTS)[number];

export function doubtsFromContact(details: {
  address?: string | null;
  phone?: string | null;
  website?: string | null;
}): EnrichmentDoubt[] {
  const doubts: EnrichmentDoubt[] = [];

  const address = details.address?.trim();
  const phone = details.phone?.trim();

  // An absent address cannot also be doubted for being foreign, so these are
  // one decision rather than two. The address is the field the form most
  // needs, which is why its absence is stated rather than left as an empty
  // box the user meets at filing time.
  if (!address) {
    doubts.push("missing_address");
  } else if (!US_ADDRESS.test(address)) {
    doubts.push("address_outside_us");
  }

  if (!phone) {
    doubts.push("missing_phone");
  }

  // A missing website raises nothing, because the form does not ask for one.
  return doubts;
}
