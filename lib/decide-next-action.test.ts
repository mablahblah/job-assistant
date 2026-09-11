import { describe, expect, test } from "vitest";
import type { ApplyLink } from "./apply-links";
import { decideNextAction } from "./decide-next-action";

const PAGES_LEFT = true;
const NO_PAGES_LEFT = false;

describe("AC 22: a page with no apply-like link resolves where it stands", () => {
  test("an empty list of apply links is a resolution", () => {
    expect(decideNextAction([], PAGES_LEFT)).toEqual({
      action: "resolved",
      reason: "no_apply_links",
    });
  });
});

describe("AC 23: a page whose only apply links have no href resolves where it stands", () => {
  test("an anchor carrying an empty href is not a link worth following", () => {
    const links: ApplyLink[] = [{ href: "", text: "Apply Now" }];

    expect(decideNextAction(links, PAGES_LEFT)).toEqual({
      action: "resolved",
      reason: "no_apply_links",
    });
  });
});

describe("AC 24: a page whose only apply links are # or javascript: resolves where it stands", () => {
  test("a bare hash is a modal trigger, not a destination", () => {
    const links: ApplyLink[] = [{ href: "#", text: "Apply" }];

    expect(decideNextAction(links, PAGES_LEFT)).toEqual({
      action: "resolved",
      reason: "no_apply_links",
    });
  });

  test("a javascript: href is a modal trigger, not a destination", () => {
    const links: ApplyLink[] = [{ href: "javascript:void(0)", text: "Apply" }];

    expect(decideNextAction(links, PAGES_LEFT)).toEqual({
      action: "resolved",
      reason: "no_apply_links",
    });
  });

  test("a mix of modal triggers with nothing real among them still resolves", () => {
    const links: ApplyLink[] = [
      { href: "", text: "Apply" },
      { href: "#", text: "Apply Now" },
      { href: "javascript:openModal()", text: "View Job" },
    ];

    expect(decideNextAction(links, PAGES_LEFT)).toEqual({
      action: "resolved",
      reason: "no_apply_links",
    });
  });
});

describe("AC 40: a link worth following is followed while budget remains", () => {
  test("the one real link is followed", () => {
    const links: ApplyLink[] = [{ href: "https://employer.example/careers/9", text: "Apply" }];

    expect(decideNextAction(links, PAGES_LEFT)).toEqual({
      action: "follow",
      nextUrl: "https://employer.example/careers/9",
    });
  });

  test("modal triggers are stepped over to reach the first real link", () => {
    const links: ApplyLink[] = [
      { href: "#", text: "Apply" },
      { href: "https://employer.example/careers/9", text: "Apply Now" },
    ];

    expect(decideNextAction(links, PAGES_LEFT)).toEqual({
      action: "follow",
      nextUrl: "https://employer.example/careers/9",
    });
  });
});

describe("AC 33: the first acceptable link wins, whatever host it points at", () => {
  test("a same-host link listed first is followed over an off-host one", () => {
    const links: ApplyLink[] = [
      { href: "https://board.example/apply/9", text: "Apply" },
      { href: "https://employer.example/careers/9", text: "View Job" },
    ];

    expect(decideNextAction(links, PAGES_LEFT)).toEqual({
      action: "follow",
      nextUrl: "https://board.example/apply/9",
    });
  });

  test("an off-host link listed first is followed over a same-host one", () => {
    const links: ApplyLink[] = [
      { href: "https://employer.example/careers/9", text: "View Job" },
      { href: "https://board.example/apply/9", text: "Apply" },
    ];

    expect(decideNextAction(links, PAGES_LEFT)).toEqual({
      action: "follow",
      nextUrl: "https://employer.example/careers/9",
    });
  });
});

describe("AC 41: with no budget left the walk ends where it stands", () => {
  test("a link worth following is not followed once the budget is spent", () => {
    const links: ApplyLink[] = [{ href: "https://employer.example/careers/9", text: "Apply" }];

    expect(decideNextAction(links, NO_PAGES_LEFT)).toEqual({
      action: "budget_spent",
      unfollowedUrl: "https://employer.example/careers/9",
    });
  });

  test("a page with nothing to follow still resolves, budget or no budget", () => {
    expect(decideNextAction([], NO_PAGES_LEFT)).toEqual({
      action: "resolved",
      reason: "no_apply_links",
    });
  });

  test("a page of modal triggers only still resolves, budget or no budget", () => {
    const links: ApplyLink[] = [{ href: "#", text: "Apply" }];

    expect(decideNextAction(links, NO_PAGES_LEFT)).toEqual({
      action: "resolved",
      reason: "no_apply_links",
    });
  });
});

describe("the link the budget stopped the walk reaching is named", () => {
  test("modal triggers are stepped over to name the first real link", () => {
    const links: ApplyLink[] = [
      { href: "#", text: "Apply" },
      { href: "https://employer.example/careers/9", text: "Apply Now" },
    ];

    expect(decideNextAction(links, NO_PAGES_LEFT)).toEqual({
      action: "budget_spent",
      unfollowedUrl: "https://employer.example/careers/9",
    });
  });
});
