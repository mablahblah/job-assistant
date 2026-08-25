import type { Page } from 'playwright';
import { isBlacklistedUrl } from './blacklist';

// --- Types ---

export interface ApplyLink {
  href: string;
  text: string;
}

export interface DeadEndResult {
  isDeadEnd: boolean;
  reason?: 'login_wall' | 'paywall' | 'signup_wall';
}

export interface ResolutionHop {
  url: string;
  domain: string;
}

export interface ResolutionChain {
  jobId: string;
  startUrl: string;
  hops: ResolutionHop[];
  finalDomain: string;
  status: 'resolved' | 'dead_end' | 'blacklisted' | 'uncertain' | 'unresolved' | 'error';
  deadEndReason?: string;
  errorMessage?: string;
}

// --- Domain utilities ---

// Extracts the hostname from a URL, returns the raw string if parsing fails
export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// Compares two URLs by exact hostname match
export function isSameDomain(url1: string, url2: string): boolean {
  return extractDomain(url1) === extractDomain(url2);
}

// --- Dead end detection ---

// Checks page HTML for signals that the page is gated (login, signup, paywall).
// Conservative: only flags strong signals to avoid false positives on real job pages.
export function detectDeadEndSignals(html: string): DeadEndResult {
  // Login wall: password input is a strong signal
  if (/<input[^>]*type\s*=\s*["']password["']/i.test(html)) {
    return { isDeadEnd: true, reason: 'login_wall' };
  }

  // Signup wall: "create account to view/apply/access/continue"
  if (/create\s+(an?\s+)?account\s+to\s+(view|apply|continue|access|see)/i.test(html)) {
    return { isDeadEnd: true, reason: 'signup_wall' };
  }
  if (/sign\s+up\s+to\s+(view|apply|continue|access|see)/i.test(html)) {
    return { isDeadEnd: true, reason: 'signup_wall' };
  }

  // Paywall: subscription required to access content
  if (/subscribe\s+to\s+(view|access|see|unlock)/i.test(html)) {
    return { isDeadEnd: true, reason: 'paywall' };
  }
  if (/start\s+your\s+free\s+trial/i.test(html)) {
    return { isDeadEnd: true, reason: 'paywall' };
  }
  if (/upgrade\s+(to\s+)?(view|access|see|unlock)/i.test(html)) {
    return { isDeadEnd: true, reason: 'paywall' };
  }

  return { isDeadEnd: false };
}

// --- Apply link filtering ---

const APPLY_LINK_PATTERNS = /\b(apply(\s+now)?|view\s+(original|job|posting)|see\s+(original|job)|visit\s+(job|posting))\b/i;

// Filters a list of page links to only those with apply-like text
export function filterApplyLinks(links: { href: string; text: string }[]): ApplyLink[] {
  return links.filter(link => APPLY_LINK_PATTERNS.test(link.text));
}

// --- Decision logic ---

// Decides what to do with the current page based on its apply links.
// Pure function: no side effects, easily testable.
export function decideNextAction(
  currentUrl: string,
  applyLinks: ApplyLink[],
  depth: number,
  maxDepth: number,
): { action: 'resolved' | 'uncertain' | 'unresolved' } | { action: 'follow'; nextUrl: string } {
  // No apply links at all — we've arrived at a final destination
  if (applyLinks.length === 0) {
    return { action: 'resolved' };
  }

  // Separate real links from likely modal triggers (no href, #, javascript:)
  const realLinks = applyLinks.filter(
    l => l.href && l.href !== '#' && !l.href.startsWith('javascript:'),
  );

  // All links are modal triggers — flag for manual review
  if (realLinks.length === 0) {
    return { action: 'uncertain' };
  }

  // WeLoveProduct: /apply subpath redirects to the real employer site
  const isWeLoveProduct = extractDomain(currentUrl) === 'weloveproduct.co';
  const applySubpathLink = realLinks.find(l =>
    isSameDomain(currentUrl, l.href) && new URL(l.href).pathname.endsWith('/apply'),
  );
  if (isWeLoveProduct && applySubpathLink && depth + 1 < maxDepth) {
    return { action: 'follow', nextUrl: applySubpathLink.href };
  }


  // If any link points to the same domain, we've arrived (apply is on-site)
  const sameDomainLink = realLinks.find(l => isSameDomain(currentUrl, l.href));
  if (sameDomainLink) {
    return { action: 'resolved' };
  }

  // Links point to a different domain — follow if we have depth budget
  if (depth + 1 >= maxDepth) {
    return { action: 'unresolved' };
  }

  return { action: 'follow', nextUrl: realLinks[0].href };
}

// --- Hop status check ---

// Combined hop check — blacklist + dead-end signals.
// Called after each hop during URL resolution.
export function checkHopStatus(
  url: string,
  html: string,
): { bail: true; status: 'dead_end' | 'blacklisted'; reason: string } | { bail: false } {
  // Blacklist — known-bad domain, skip entirely (separate from dead_end)
  if (isBlacklistedUrl(url)) {
    return { bail: true, status: 'blacklisted', reason: 'blacklisted' };
  }

  // Dead-end signals (login wall, paywall, signup wall)
  const deadEnd = detectDeadEndSignals(html);
  if (deadEnd.isDeadEnd) {
    return { bail: true, status: 'dead_end', reason: deadEnd.reason! };
  }

  return { bail: false };
}

// --- Playwright resolver ---

// Follows a job URL through its chain of hops (redirects + apply links) until
// it reaches a final destination, dead end, or max depth.
export async function resolveJobUrl(
  startUrl: string,
  jobId: string,
  page: Page,
  maxDepth = 4,
): Promise<ResolutionChain> {
  const hops: ResolutionHop[] = [];
  let currentUrl = startUrl;

  for (let depth = 0; depth < maxDepth; depth++) {
    // Navigate with Playwright (follows HTTP redirects automatically)
    let response;
    try {
      response = await page.goto(currentUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
    } catch {
      return {
        jobId, startUrl, hops,
        finalDomain: extractDomain(currentUrl),
        status: 'error',
        errorMessage: `Failed to load ${currentUrl}`,
      };
    }

    // Record redirect chain from Playwright's request API
    if (response) {
      const redirectChain: string[] = [];
      let req = response.request();
      while (req) {
        redirectChain.unshift(req.url());
        req = req.redirectedFrom();
      }
      for (const url of redirectChain) {
        if (hops.length === 0 || hops[hops.length - 1].url !== url) {
          hops.push({ url, domain: extractDomain(url) });
        }
      }
    }

    // Page may have JS-redirected after load
    const pageUrl = page.url();
    const pageDomain = extractDomain(pageUrl);
    if (hops.length === 0 || hops[hops.length - 1].url !== pageUrl) {
      hops.push({ url: pageUrl, domain: pageDomain });
    }

    // Check for dead end signals in page content
    let html: string;
    try {
      html = await page.content();
    } catch {
      return {
        jobId, startUrl, hops,
        finalDomain: pageDomain,
        status: 'error',
        errorMessage: `Page still navigating at ${pageUrl}`,
      };
    }
    const hopCheck = checkHopStatus(pageUrl, html);
    if (hopCheck.bail) {
      return {
        jobId, startUrl, hops,
        finalDomain: pageDomain,
        status: hopCheck.status,
        deadEndReason: hopCheck.reason,
      };
    }

    // Extract all links, filter to apply-like ones
    let rawLinks: { href: string; text: string }[];
    try {
      rawLinks = await page.$$eval('a', anchors =>
        anchors.map(a => ({ href: a.href, text: a.textContent?.trim() ?? '' })),
      );
    } catch {
      return {
        jobId, startUrl, hops,
        finalDomain: pageDomain,
        status: 'error',
        errorMessage: `Page closed during link extraction at ${pageUrl}`,
      };
    }
    const applyLinks = filterApplyLinks(rawLinks);

    // Decide: resolved, uncertain, follow, or unresolved
    const decision = decideNextAction(pageUrl, applyLinks, depth, maxDepth);

    if (decision.action === 'follow') {
      currentUrl = decision.nextUrl;
      continue;
    }

    return {
      jobId, startUrl, hops,
      finalDomain: pageDomain,
      status: decision.action,
    };
  }

  return {
    jobId, startUrl, hops,
    finalDomain: extractDomain(currentUrl),
    status: 'unresolved',
  };
}

// --- Output formatting ---

// Builds a terminal-friendly report: summary counts + frequency tables for
// resolved destinations and dead-end domains.
export function formatResults(chains: ResolutionChain[]): string {
  const total = chains.length;
  if (total === 0) return 'URL Resolution Results\n======================\nTotal:      0\n';

  // Count by status
  const counts: Record<string, number> = {};
  for (const chain of chains) {
    counts[chain.status] = (counts[chain.status] ?? 0) + 1;
  }

  const pct = (n: number) => `(${((n / total) * 100).toFixed(1)}%)`;
  const pad = (s: string | number, len: number) => String(s).padStart(len);

  let out = '';
  out += 'URL Resolution Results\n';
  out += '======================\n';
  out += `Total:      ${total}\n`;
  out += `Resolved:   ${counts['resolved'] ?? 0} ${pct(counts['resolved'] ?? 0)}\n`;
  out += `Dead ends:  ${counts['dead_end'] ?? 0} ${pct(counts['dead_end'] ?? 0)}\n`;
  out += `Uncertain:  ${counts['uncertain'] ?? 0} ${pct(counts['uncertain'] ?? 0)}\n`;
  out += `Unresolved: ${counts['unresolved'] ?? 0} ${pct(counts['unresolved'] ?? 0)}\n`;
  out += `Errors:     ${counts['error'] ?? 0} ${pct(counts['error'] ?? 0)}\n`;

  // Frequency table helper: groups chains by finalDomain, sorted highest-count first
  const freqTable = (label: string, items: ResolutionChain[]) => {
    const domainCounts: Record<string, number> = {};
    for (const item of items) {
      domainCounts[item.finalDomain] = (domainCounts[item.finalDomain] ?? 0) + 1;
    }
    const sorted = Object.entries(domainCounts).sort((a, b) => b[1] - a[1]);
    if (sorted.length === 0) return '';

    const maxLen = Math.max(...sorted.map(([d]) => d.length));
    const itemTotal = items.length;
    let table = `\n${label}\n${'='.repeat(label.length)}\n`;
    for (const [domain, count] of sorted) {
      const domainPct = ((count / itemTotal) * 100).toFixed(1);
      table += `  ${domain.padEnd(maxLen)}  ${pad(count, 4)}  (${domainPct}%)\n`;
    }
    return table;
  };

  out += freqTable(
    'Final Destinations (Resolved)',
    chains.filter(c => c.status === 'resolved'),
  );
  out += freqTable(
    'Dead End Domains',
    chains.filter(c => c.status === 'dead_end'),
  );

  return out;
}
