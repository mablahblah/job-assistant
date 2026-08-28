// Matches a set of user search terms against a site's fixed list of
// categories. A collector that browses by category rather than by free-text
// search uses this to decide which category pages to visit.

export interface Category {
  value: string;
  label: string;
}

// A category matches when every word of at least one search term appears as
// a substring of its label, case-insensitively. Each matched category comes
// back once, in the order it was first matched.
export function matchCategories(searchTerms: string[], categories: Category[]): Category[] {
  const matched = new Set<string>();
  const results: Category[] = [];

  for (const term of searchTerms) {
    const words = term.toLowerCase().split(/\s+/).filter(Boolean);

    for (const category of categories) {
      if (matched.has(category.value)) continue;
      const label = category.label.toLowerCase();
      const allMatch = words.every((word) => label.includes(word));
      if (allMatch) {
        matched.add(category.value);
        results.push(category);
      }
    }
  }

  return results;
}
