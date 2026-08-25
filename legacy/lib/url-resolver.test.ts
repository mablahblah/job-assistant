import { describe, it, expect } from 'vitest';
import {
  extractDomain, isSameDomain, detectDeadEndSignals,
  filterApplyLinks, decideNextAction, formatResults,
  checkHopStatus,
  type ResolutionChain,
} from './url-resolver';

describe('extractDomain', () => {
  it('extracts hostname from a full URL', () => {
    expect(extractDomain('https://boards.greenhouse.io/company/jobs/123')).toBe('boards.greenhouse.io');
  });

  it('extracts hostname from a simple URL', () => {
    expect(extractDomain('https://lever.co/jobs/456')).toBe('lever.co');
  });

  it('returns the input string when URL is invalid', () => {
    expect(extractDomain('not-a-url')).toBe('not-a-url');
  });
});

describe('isSameDomain', () => {
  it('returns true for matching hostnames', () => {
    expect(isSameDomain(
      'https://greenhouse.io/jobs/1',
      'https://greenhouse.io/apply/1',
    )).toBe(true);
  });

  it('returns false for different hostnames', () => {
    expect(isSameDomain(
      'https://remotelead.com/jobs/1',
      'https://boards.greenhouse.io/apply/1',
    )).toBe(false);
  });

  it('treats subdomains as different domains', () => {
    expect(isSameDomain(
      'https://boards.greenhouse.io/jobs/1',
      'https://greenhouse.io/jobs/1',
    )).toBe(false);
  });
});

describe('detectDeadEndSignals', () => {
  it('detects login wall from password input', () => {
    const html = '<form><input type="password" name="pass"><button>Log in</button></form>';
    expect(detectDeadEndSignals(html)).toEqual({ isDeadEnd: true, reason: 'login_wall' });
  });

  it('detects signup wall from account creation prompt', () => {
    const html = '<div>Create an account to view this job posting</div>';
    expect(detectDeadEndSignals(html)).toEqual({ isDeadEnd: true, reason: 'signup_wall' });
  });

  it('detects signup wall from sign-up-to-view prompt', () => {
    const html = '<div>Sign up to access job details</div>';
    expect(detectDeadEndSignals(html)).toEqual({ isDeadEnd: true, reason: 'signup_wall' });
  });

  it('detects paywall from subscription prompt', () => {
    const html = '<div>Subscribe to view full job listing</div>';
    expect(detectDeadEndSignals(html)).toEqual({ isDeadEnd: true, reason: 'paywall' });
  });

  it('detects paywall from free trial prompt', () => {
    const html = '<div>Start your free trial to unlock all jobs</div>';
    expect(detectDeadEndSignals(html)).toEqual({ isDeadEnd: true, reason: 'paywall' });
  });

  it('returns not dead end for normal job page', () => {
    const html = '<div><h1>Senior Product Designer</h1><p>We are looking for...</p><a href="/apply">Apply Now</a></div>';
    expect(detectDeadEndSignals(html)).toEqual({ isDeadEnd: false });
  });

  it('does not false-positive on newsletter signup', () => {
    const html = '<div><h1>Product Designer</h1><p>Great role!</p><footer>Sign up for our newsletter</footer></div>';
    expect(detectDeadEndSignals(html)).toEqual({ isDeadEnd: false });
  });
});

describe('filterApplyLinks', () => {
  it('includes links with "Apply Now" text', () => {
    const links = [{ href: 'https://example.com/apply', text: 'Apply Now' }];
    expect(filterApplyLinks(links)).toEqual(links);
  });

  it('includes links with "Apply" text', () => {
    const links = [{ href: 'https://example.com/apply', text: 'Apply' }];
    expect(filterApplyLinks(links)).toEqual(links);
  });

  it('includes links with "View Original" text', () => {
    const links = [{ href: 'https://example.com/job', text: 'View Original' }];
    expect(filterApplyLinks(links)).toEqual(links);
  });

  it('includes links with "View Job" text', () => {
    const links = [{ href: 'https://example.com/job', text: 'View Job' }];
    expect(filterApplyLinks(links)).toEqual(links);
  });

  it('excludes links with unrelated text', () => {
    const links = [
      { href: 'https://example.com/save', text: 'Save' },
      { href: 'https://example.com/share', text: 'Share' },
      { href: 'https://example.com/about', text: 'Learn More' },
    ];
    expect(filterApplyLinks(links)).toEqual([]);
  });

  it('filters a mixed list correctly', () => {
    const links = [
      { href: 'https://example.com/about', text: 'About Us' },
      { href: 'https://greenhouse.io/apply', text: 'Apply Now' },
      { href: 'https://example.com/share', text: 'Share Job' },
      { href: 'https://lever.co/job/123', text: 'View Job Posting' },
    ];
    expect(filterApplyLinks(links)).toEqual([
      { href: 'https://greenhouse.io/apply', text: 'Apply Now' },
      { href: 'https://lever.co/job/123', text: 'View Job Posting' },
    ]);
  });

  it('matches case-insensitively', () => {
    const links = [{ href: 'https://example.com/apply', text: 'APPLY NOW' }];
    expect(filterApplyLinks(links)).toEqual(links);
  });
});

describe('decideNextAction', () => {
  const currentUrl = 'https://remotelead.com/jobs/123';

  it('returns resolved when no apply links exist', () => {
    expect(decideNextAction(currentUrl, [], 0, 4)).toEqual({ action: 'resolved' });
  });

  it('returns uncertain when all links are modal triggers (no href)', () => {
    const links = [
      { href: '#', text: 'Apply' },
      { href: 'javascript:void(0)', text: 'Apply Now' },
    ];
    expect(decideNextAction(currentUrl, links, 0, 4)).toEqual({ action: 'uncertain' });
  });

  it('returns resolved when apply link is same domain', () => {
    const links = [{ href: 'https://remotelead.com/apply/123', text: 'Apply' }];
    expect(decideNextAction(currentUrl, links, 0, 4)).toEqual({ action: 'resolved' });
  });

  it('returns follow with URL when apply link is different domain', () => {
    const links = [{ href: 'https://boards.greenhouse.io/company/jobs/456', text: 'Apply Now' }];
    expect(decideNextAction(currentUrl, links, 0, 4)).toEqual({
      action: 'follow',
      nextUrl: 'https://boards.greenhouse.io/company/jobs/456',
    });
  });

  it('returns unresolved when different-domain link exists but at max depth', () => {
    const links = [{ href: 'https://greenhouse.io/jobs/456', text: 'Apply' }];
    expect(decideNextAction(currentUrl, links, 3, 4)).toEqual({ action: 'unresolved' });
  });

  it('prefers same-domain link over different-domain link', () => {
    const links = [
      { href: 'https://greenhouse.io/jobs/456', text: 'Apply on Greenhouse' },
      { href: 'https://remotelead.com/apply/123', text: 'Apply Here' },
    ];
    expect(decideNextAction(currentUrl, links, 0, 4)).toEqual({ action: 'resolved' });
  });

  it('skips modal triggers and follows real links', () => {
    const links = [
      { href: '#', text: 'Quick Apply' },
      { href: 'https://greenhouse.io/jobs/456', text: 'Apply on Greenhouse' },
    ];
    expect(decideNextAction(currentUrl, links, 0, 4)).toEqual({
      action: 'follow',
      nextUrl: 'https://greenhouse.io/jobs/456',
    });
  });
});

describe('formatResults', () => {
  it('produces summary counts and frequency tables', () => {
    const chains: ResolutionChain[] = [
      { jobId: '1', startUrl: 'https://a.com/1', hops: [], finalDomain: 'greenhouse.io', status: 'resolved' },
      { jobId: '2', startUrl: 'https://a.com/2', hops: [], finalDomain: 'greenhouse.io', status: 'resolved' },
      { jobId: '3', startUrl: 'https://a.com/3', hops: [], finalDomain: 'lever.co', status: 'resolved' },
      { jobId: '4', startUrl: 'https://a.com/4', hops: [], finalDomain: 'joblead.com', status: 'dead_end', deadEndReason: 'paywall' },
      { jobId: '5', startUrl: 'https://a.com/5', hops: [], finalDomain: 'unknown.com', status: 'uncertain' },
    ];

    const result = formatResults(chains);

    // Summary section
    expect(result).toContain('Total:      5');
    expect(result).toContain('Resolved:   3');
    expect(result).toContain('Dead ends:  1');
    expect(result).toContain('Uncertain:  1');

    // Resolved domains ranked by frequency
    expect(result).toContain('greenhouse.io');
    expect(result).toContain('lever.co');
    // greenhouse.io should appear before lever.co (higher count)
    expect(result.indexOf('greenhouse.io')).toBeLessThan(result.indexOf('lever.co'));

    // Dead end domains
    expect(result).toContain('joblead.com');
  });

  it('handles empty results', () => {
    const result = formatResults([]);
    expect(result).toContain('Total:      0');
  });
});

describe("checkHopStatus", () => {
  it("returns blacklisted status for a blacklisted domain", () => {
    const result = checkHopStatus("https://jobleads.com/job/123", "<html></html>");
    expect(result).toEqual({
      bail: true,
      status: "blacklisted",
      reason: "blacklisted",
    });
  });

  it("returns login_wall bail for a page with a password input", () => {
    const html = '<form><input type="password" name="pass"></form>';
    const result = checkHopStatus("https://example.com/login", html);
    expect(result).toEqual({
      bail: true,
      status: "dead_end",
      reason: "login_wall",
    });
  });

  it("returns no bail for a clean page on a non-blacklisted domain", () => {
    const html = "<html><body><h1>Job Posting</h1></body></html>";
    const result = checkHopStatus("https://jobs.ashbyhq.com/company/123", html);
    expect(result).toEqual({ bail: false });
  });

  it("checks blacklist before dead-end signals — blacklist takes priority", () => {
    const html = '<form><input type="password"></form>';
    const result = checkHopStatus("https://jobleads.com/job/123", html);
    expect(result.reason).toBe("blacklisted");
  });
});
