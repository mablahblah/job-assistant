// Central config for all scrapers — set enabled: false to skip during Scrape All

export const SCRAPER_CONFIG = {
  adzuna: { enabled: true },
  jsearch: { enabled: false },
  dribbble: { enabled: false },
  weloveproduct: { enabled: false },
  greenhouse: {
    enabled: false,
    slugs: [
      "gitlab",
      "hubspot",
      "duolingo",
      "stripe",
      "asana",
      "lyft",
      "dropbox",
      "squarespace",
      "snap",
      "hellofresh",
    ],
  },
  lever: {
    enabled: false,
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
