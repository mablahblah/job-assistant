// Search terms used by keyword-based collectors (adzuna, jsearch, dribbble, etc.)
export const SEARCH_TERMS = ["Product Design", "UX", "Founding Design"];

// Controls which job sources are active and (for Greenhouse/Lever) which company slugs to query
export const COLLECTOR_CONFIG = {
  adzuna: {
    enabled: true,
    // Excluded from Adzuna via what_exclude — aggregators that waste result slots
    excludeTerms: ["jobgether"],
  },
  jsearch: { enabled: true },
  dribbble: { enabled: true },
  weloveproduct: { enabled: true },
  uiuxjobsboard: { enabled: true },
  greenhouse: {
    enabled: true,
    slugs: [
      "gitlab",
      "hubspot",
      "duolingo",
      "stripe",
      "asana",
      "lyft",
      "dropbox",
      "squarespace",
      "hellofresh",
      "intercom",
      "coursera",
      "modernhealth",
      "calm",
      "figma",
    ],
  },
  lever: {
    enabled: true,
    slugs: ["plaid"],
  },
} as const;
