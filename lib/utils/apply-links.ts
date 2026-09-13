// One link read off a page: where it points, and the words a reader sees.
export interface ApplyLink {
  href: string;
  text: string;
}

// Matches text that reads like an invitation to apply or to view the original
// posting. Word boundaries prevent partial matches — "Share Job" will not
// match because the pattern requires "view job" or "see job" or "visit job",
// not a bare "job". The i flag makes the pattern case-insensitive.
const APPLY_LINK_PATTERNS =
  /\b(apply(\s+now)?|view\s+(original|job|posting)|see\s+(original|job)|visit\s+(job|posting))\b/i;

// Keeps only the links whose visible text reads like an invitation to apply
// or to see the original posting, in the order given. These are the links
// resolution follows onward toward the employer's own posting.
export function filterApplyLinks(links: ApplyLink[]): ApplyLink[] {
  return links.filter((link) => APPLY_LINK_PATTERNS.test(link.text));
}
