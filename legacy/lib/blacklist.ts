// Domain blacklist — blocks known paywalled, spam, and junk job board URLs
// Used at collection time (scraper-save) and during URL traversal (future parser system)

export const BLACKLISTED_DOMAINS: readonly string[] = [
  // Paywalled aggregators
  "jobleads.com",
  "learn4good.com",
  "remote.co",
  "jobrapido.com",
  // Spam destinations
  "ihire.allboardsolutions.in",
  "remotejobs.victorytuitions.in",
  "suspended-domain.net",
  "cosmoquick.com",
  "remotejobs.trendingnewsgo.com",
  // Spam sources
  "liveblog365.com",
  "remotearbor.xyz",
  "novaedge.page.gd",
  "hirro.kesug.com",
  "flexjobs.zya.me",
];

// Checks if a URL's hostname matches any blacklisted domain (exact or subdomain)
export function isBlacklistedUrl(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }

  return BLACKLISTED_DOMAINS.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
  );
}
