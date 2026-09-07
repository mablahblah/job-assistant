// Turns job titles and search terms into comparable tokens, so a collector
// filtering its results against the search terms applies one shared rule.
// Both sides go through the same normalization, which is what lets the term
// "Product Design" match the title "Senior Product Designer".
import { stemmer } from "stemmer";

// Tokens of three characters or fewer skip stemming. The stemmer shortens
// some of them into other real words — stemmer("uxs") returns "ux" — which
// would make every "UxS" title match the search term "UX". The cutoff is
// three or fewer rather than under three, because "uxs" is exactly three
// characters and an "under three" guard would let it through.
function stemToken(token: string): string {
  return token.length <= 3 ? token : stemmer(token);
}

// Splits on any run of characters that are neither letters nor numbers. The
// match is Unicode-aware so an accent counts as part of its letter: a plain
// [^a-zA-Z0-9]+ split would break "Ingénieur" into two fragments.
export function analyzeText(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0)
    .map(stemToken);
}

// True when at least one search term matches, and a term matches when every
// word it holds is present in the title. The title is analyzed once and
// reused across the terms rather than re-analyzed for each one.
export function matchesSearchTerms(title: string, searchTerms: string[]): boolean {
  const titleTokens = new Set(analyzeText(title));

  return searchTerms.some((term) => {
    const termTokens = analyzeText(term);
    // A blank term analyzes to no words, and "every word present" is
    // vacuously true of no words, so one stray blank term in settings would
    // otherwise match every job collected.
    if (termTokens.length === 0) return false;
    return termTokens.every((token) => titleTokens.has(token));
  });
}
