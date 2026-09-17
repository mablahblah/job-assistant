// Whether one internet search result's title names the employer that was
// searched for. A search returns about ten results covering anything the words
// happened to hit, so a contact detail is read only out of a result that
// passes this check.
//
// The old code checked the name on the first result alone while taking values
// from any result in the list, and the two were never connected. Measured
// against the live service for one employer, that would have taken an
// unrelated university's address off a government-contracts listing.
//
// The rule has a measured weakness carried over on purpose. An employer
// stored under a longer name than the world uses loses most of its own
// results: "Bolna AI" matched two of ten, because the company is known as
// "Bolna". Fixing that is a decision of its own.
//
// A blank on either side answers no. An empty string is contained by every
// string, so a blank would match every result and hand back the first
// stranger's address.
export function matchesCompanyName(companyName: string, title: string): boolean {
  const name = companyName.trim().toLowerCase();
  const heading = title.trim().toLowerCase();

  if (!name || !heading) return false;

  return name.includes(heading) || heading.includes(name);
}
