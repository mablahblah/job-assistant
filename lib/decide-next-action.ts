import type { ApplyLink } from "./apply-links";

// The decision made at one page while resolving a job link toward its
// employer posting: resolve here, follow a link, or stop because the hop
// budget ran out.
export type NextAction =
  | { action: "resolved"; reason: "no_apply_links" }
  | { action: "follow"; nextUrl: string }
  | { action: "budget_spent" };

// A modal trigger is an apply link with nothing real behind it: no href,
// a bare "#", or javascript: code meant to pop a dialog rather than
// navigate anywhere. Following one would not move the walk forward.
function isModalTrigger(href: string): boolean {
  return href === "" || href === "#" || href.startsWith("javascript:");
}

// The one decision made at each hop of the resolver's walk: whether the
// page in hand is already the resolution, whether to follow its first
// real apply link onward, or whether the hop budget has run out. It only
// looks at the links already collected and the budget flag handed to it,
// so it can be tested without a browser and reused for every source.
//
// It never compares hosts. Whether a hop stayed on its own host is judged
// after the browser lands, because a link's href can redirect elsewhere and
// reading the href here would misjudge those.
export function decideNextAction(
  applyLinks: ApplyLink[],
  hopBudgetRemains: boolean,
): NextAction {
  const realLink = applyLinks.find((link) => !isModalTrigger(link.href));

  // No link worth following means this page is the resolution, whether
  // or not there is budget left to spend.
  if (!realLink) {
    return { action: "resolved", reason: "no_apply_links" };
  }

  if (!hopBudgetRemains) {
    return { action: "budget_spent" };
  }

  return { action: "follow", nextUrl: realLink.href };
}
