// Central config for all scrapers — set enabled: true to skip during Scrape All

export const SCRAPER_CONFIG = {
  adzuna: { enabled: true },
  jsearch: { enabled: true },
  dribbble: { enabled: true },
  weloveproduct: { enabled: true },
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
    slugs: [
      // "netflix",
      "plaid",
      // "benchling",
      // "atlassian",
    ],
  },
} as const;
