// Central config for all scrapers — set enabled: false to skip during Scrape All

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
    ],
  },
  lever: {
    enabled: true,
    slugs: [
      "netflix",
      "spotify",
      "figma",
      "plaid",
      "intercom",
      "coursera",
      "modernhealth",
      "calm",
      "benchling",
      "atlassian",
    ],
  },
} as const;
