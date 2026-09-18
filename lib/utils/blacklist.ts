// Hosts a job is never worth following to — paywalled aggregators that hide the
// posting behind a subscription, spam destinations that redirects commonly land
// on, and spam sources that republish low-quality postings. A job's resolution that reaches
// one of these stops there and the job is dropped rather than resolved.
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

// Checks whether a URL's hostname matches a blacklisted domain. Returns true
// for an exact match or a subdomain — www.jobleads.com and jobs.uk.jobleads.com
// both match jobleads.com. Returns false for invalid URLs and non-matching
// hostnames, never throwing an error.
export function isBlacklistedUrl(url: string): boolean {
  let hostname: string;
  try {
    // The URL constructor parses the string and lowercases the hostname for
    // case-insensitive comparison. It rejects anything that is not a valid URL
    // — plain words, empty strings, hosts without a scheme.
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    // Strings that cannot be parsed as URLs are not on blacklisted domains.
    return false;
  }

  // A hostname matches if it equals a listed domain, or is a subdomain (ends
  // with a dot followed by the domain). The dot check prevents false positives
  // like notjobleads.com matching jobleads.com.
  return BLACKLISTED_DOMAINS.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
  );
}
