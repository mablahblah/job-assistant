// Joins the parts of a place a source hands over separately — a city, a
// state, a country — into the one line a job's location list holds. Parts
// that are missing or blank are dropped, and nothing at all comes back when
// no part names anything.
export function placeFromParts(parts: ReadonlyArray<string | null | undefined>): string | undefined {
  const present = parts.filter((part): part is string => Boolean(part && part.trim()));
  return present.length > 0 ? present.join(", ") : undefined;
}
