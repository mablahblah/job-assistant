import type { ApplyLink } from "./apply-links";

// The decision made at one page while resolving a job link toward its
// employer posting: resolve here, follow a link, or stop because the page
// budget ran out. A stop names the link it did not follow, which is the
// link it would have followed with budget left — resolution reads it to tell
// a posting it never reached from an apply form it was right to stop short
// of.
export type NextAction =
  | { action: "resolved"; reason: "no_apply_links" }
  | { action: "follow"; nextUrl: string }
  | { action: "budget_spent"; unfollowedUrl: string };

// A modal trigger is an apply link with nothing real behind it: no href,
// a bare "#", or javascript: code meant to pop a dialog rather than
// navigate anywhere. Following one would not move resolution forward.
function isModalTrigger(href: string): boolean {
  return href === "" || href === "#" || href.startsWith("javascript:");
}

// The one decision made at each page of resolution: whether the
// page in hand is already the resolution, whether to follow its first
// real apply link onward, or whether the page limit has run out. It only
// looks at the links already collected and the budget flag handed to it,
// so it can be tested without a browser and reused for every source.
//
// It never compares hosts itself. Whether a page stayed on its own host is
// judged after the browser lands, because a link's href can redirect
// elsewhere and reading the href here would misjudge those.
export function decideNextAction(
  applyLinks: ApplyLink[],
  pagesLeft: boolean,
): NextAction {
  const realLink = applyLinks.find((link) => !isModalTrigger(link.href));

  // No link worth following means this page is the resolution, whether
  // or not there is budget left to spend.
  if (!realLink) {
    return { action: "resolved", reason: "no_apply_links" };
  }

  if (!pagesLeft) {
    return { action: "budget_spent", unfollowedUrl: realLink.href };
  }

  return { action: "follow", nextUrl: realLink.href };
}
