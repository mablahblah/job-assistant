export interface Category {
  value: string;
  label: string;
}

// Returns categories where ALL words in at least one search term
// appear as substrings in the category label (case-insensitive).
export function matchCategories(
  searchTerms: string[],
  categories: Category[],
): Category[] {
  const matched = new Set<string>();
  const results: Category[] = [];

  for (const term of searchTerms) {
    const words = term.toLowerCase().split(/\s+/).filter(Boolean);

    for (const cat of categories) {
      if (matched.has(cat.value)) continue;
      const label = cat.label.toLowerCase();
      const allMatch = words.every((word) => label.includes(word));
      if (allMatch) {
        matched.add(cat.value);
        results.push(cat);
      }
    }
  }

  return results;
}
