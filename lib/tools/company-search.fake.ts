// A stand-in for the paid search service, so no test in the suite ever pays
// for a real search. A test writes a table of query to answer — results, an
// Error to reject with, or the sentinel below — and the fake answers from it,
// recording every query it was asked, in order. A handler's test proves the
// service was not asked twice about an employer already filled in, which is a
// count rather than an answer.
import type { CompanySearch, SearchResult } from "./company-search";

// The one answer the project's other stand-ins cannot give. The search tool
// carries a time limit, and testing that limit needs a search that never
// answers at all.
export const NEVER_ANSWERS: unique symbol = Symbol("NEVER_ANSWERS");

export type CompanySearchAnswer = SearchResult[] | Error | typeof NEVER_ANSWERS;

export interface FakeCompanySearch extends CompanySearch {
  asked: string[];
}

export function fakeCompanySearch(
  table: Record<string, CompanySearchAnswer> = {}
): FakeCompanySearch {
  const asked: string[] = [];

  return {
    asked,
    async search(query: string): Promise<SearchResult[]> {
      // Recorded before the answer is decided, and before anything is awaited,
      // so a query that ends up throwing or never answering is still counted
      // as having been asked.
      asked.push(query);

      // A plain object answers yes to "constructor" and "toString" and hands
      // back a function, so only a key the table really holds is trusted.
      if (!Object.prototype.hasOwnProperty.call(table, query)) return [];

      const answer = table[query];

      if (answer === NEVER_ANSWERS) {
        return new Promise<SearchResult[]>(() => {
          // Deliberately never settles.
        });
      }

      if (answer instanceof Error) throw answer;

      return answer ?? [];
    },
  };
}
