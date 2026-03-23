// Central config for all scrapers — set enabled: false to skip during Scrape All

export const SCRAPER_CONFIG = {
  adzuna: { enabled: false },
  jsearch: { enabled: false },
  dribbble: { enabled: false },
  weloveproduct: { enabled: false },
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
