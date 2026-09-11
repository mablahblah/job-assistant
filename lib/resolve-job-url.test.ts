import { describe, expect, test } from "vitest";
import { fakeResolutionPage } from "./resolution-page.fake";
import { resolveJobUrl } from "./resolve-job-url";

// Settling is its own module with its own tests. Most walks here are scripted
// as already-finished pages, so the walk is handed a settle that does nothing
// and each test says only what it is about.
const NO_WAIT = async () => {};

// A link a page offers, worded so the apply-link filter keeps it.
function applyLink(href: string): string {
  return `<a href="${href}">Apply</a>`;
}

describe("AC 6, 22, 25: a page offering nothing to follow is the resolution", () => {
  test("a page with no apply link resolves where it stands", async () => {
    const page = fakeResolutionPage([
      { url: "https://employer.example/careers/9", html: "<p>A job posting</p>" },
    ]);

    expect(
      await resolveJobUrl("https://employer.example/careers/9", page, { settle: NO_WAIT }),
    ).toEqual({
      outcome: "resolved",
      resolvedUrl: "https://employer.example/careers/9",
      reason: "no_apply_links",
    });
  });
});

describe("AC 7, 8, 9, 11: a hop that does not succeed is never a destination", () => {
  test("a 403 fails the walk rather than resolving it", async () => {
    const page = fakeResolutionPage([
      {
        url: "https://board.example/listing/1",
        responses: [{ url: "https://board.example/listing/1", status: 403 }],
      },
    ]);

    expect(
      await resolveJobUrl("https://board.example/listing/1", page, { settle: NO_WAIT }),
    ).toEqual({ outcome: "failed", reason: "page_unavailable" });
  });

  test("a 404 fails the walk even where the page still renders a job title", async () => {
    const page = fakeResolutionPage([
      {
        url: "https://board.example/listing/1",
        title: "Senior Product Designer",
        responses: [{ url: "https://board.example/listing/1", status: 404 }],
      },
    ]);

    expect(
      await resolveJobUrl("https://board.example/listing/1", page, { settle: NO_WAIT }),
    ).toEqual({ outcome: "failed", reason: "page_unavailable" });
  });
});

describe("AC 10: a hop the browser cannot load at all", () => {
  test("a goto that throws is a load failure rather than a bad status", async () => {
    const page = fakeResolutionPage([
      { url: "https://board.example/listing/1", failsToLoad: true },
    ]);

    expect(
      await resolveJobUrl("https://board.example/listing/1", page, { settle: NO_WAIT }),
    ).toEqual({ outcome: "failed", reason: "page_load_failed" });
  });
});

describe("AC 11a: the status read is the status of the page landed on", () => {
  test("a page that loads and then jumps to one that refuses takes the refusal", async () => {
    const page = fakeResolutionPage([
      {
        url: "https://employer.example/careers/9",
        responses: [
          { url: "https://redirector.example/out", status: 200 },
          { url: "https://employer.example/careers/9", status: 403 },
        ],
      },
    ]);

    expect(
      await resolveJobUrl("https://redirector.example/out", page, { settle: NO_WAIT }),
    ).toEqual({ outcome: "failed", reason: "page_unavailable" });
  });
});

describe("AC 16, 17, 21, 21a: the blacklist is checked on the settled URL", () => {
  test("a walk reaching a blacklisted host is marked blacklisted", async () => {
    const page = fakeResolutionPage([{ url: "https://jobleads.com/job/1" }]);

    expect(
      await resolveJobUrl("https://jobleads.com/job/1", page, { settle: NO_WAIT }),
    ).toEqual({ outcome: "blacklisted" });
  });

  test("a page that jumps to a blacklisted host while settling is caught", async () => {
    const page = fakeResolutionPage([
      {
        url: "https://board.example/listing/1",
        becomes: [{ url: "https://jobleads.com/job/1" }],
      },
    ]);

    expect(
      await resolveJobUrl("https://board.example/listing/1", page, {
        settle: async () => {
          page.advance();
        },
      }),
    ).toEqual({ outcome: "blacklisted" });
  });

  test("a blacklisted page carrying a dead-end signal is blacklisted, not a dead end", async () => {
    const page = fakeResolutionPage([
      { url: "https://jobleads.com/job/1", html: '<input type="password">' },
    ]);

    expect(
      await resolveJobUrl("https://jobleads.com/job/1", page, { settle: NO_WAIT }),
    ).toEqual({ outcome: "blacklisted" });
  });
});

describe("AC 26, 27, 28, 30: a same-host hop that ends the walk is discarded", () => {
  test("a same-host apply link is followed rather than treated as an arrival", async () => {
    const page = fakeResolutionPage([
      {
        url: "https://employer.example/careers/9",
        html: applyLink("https://employer.example/careers/9/apply"),
      },
      { url: "https://employer.example/careers/9/apply", html: "<p>Application form</p>" },
    ]);

    expect(
      await resolveJobUrl("https://employer.example/careers/9", page, { settle: NO_WAIT }),
    ).toEqual({
      outcome: "resolved",
      resolvedUrl: "https://employer.example/careers/9",
      reason: "stayed_on_site",
    });
  });

  test("a same-host hop landing on a dead end is discarded too", async () => {
    const page = fakeResolutionPage([
      {
        url: "https://employer.example/careers/9",
        html: applyLink("https://employer.example/careers/9/apply"),
      },
      { url: "https://employer.example/careers/9/apply", html: '<input type="password">' },
    ]);

    expect(
      await resolveJobUrl("https://employer.example/careers/9", page, { settle: NO_WAIT }),
    ).toEqual({
      outcome: "resolved",
      resolvedUrl: "https://employer.example/careers/9",
      reason: "stayed_on_site",
    });
  });
});

describe("AC 29: a same-host hop that leads onward keeps its place", () => {
  test("the hop stands and the walk carries on from where it landed", async () => {
    const page = fakeResolutionPage([
      {
        url: "https://aggregator.example/listing/1",
        html: applyLink("https://aggregator.example/listing/1/go"),
      },
      {
        url: "https://aggregator.example/listing/1/go",
        html: applyLink("https://employer.example/careers/9"),
      },
      { url: "https://employer.example/careers/9", html: "<p>A job posting</p>" },
    ]);

    expect(
      await resolveJobUrl("https://aggregator.example/listing/1", page, { settle: NO_WAIT }),
    ).toEqual({
      outcome: "resolved",
      resolvedUrl: "https://employer.example/careers/9",
      reason: "link_left_site",
    });
  });
});

describe("AC 31, 32: a hop is judged by where it landed, not by its href", () => {
  test("a same-host href that redirects away is judged off-host", async () => {
    const page = fakeResolutionPage([
      {
        url: "https://board.example/listing/1",
        html: applyLink("https://board.example/out/9"),
      },
      { url: "https://employer.example/careers/9", html: "<p>A job posting</p>" },
    ]);

    expect(
      await resolveJobUrl("https://board.example/listing/1", page, { settle: NO_WAIT }),
    ).toEqual({
      outcome: "resolved",
      resolvedUrl: "https://employer.example/careers/9",
      reason: "link_left_site",
    });
  });

  test("an off-host href that redirects back is judged same-host", async () => {
    const page = fakeResolutionPage([
      {
        url: "https://board.example/listing/1",
        html: applyLink("https://employer.example/careers/9"),
      },
      { url: "https://board.example/apply/9", html: "<p>Application form</p>" },
    ]);

    expect(
      await resolveJobUrl("https://board.example/listing/1", page, { settle: NO_WAIT }),
    ).toEqual({
      outcome: "resolved",
      resolvedUrl: "https://board.example/listing/1",
      reason: "stayed_on_site",
    });
  });
});

describe("AC 34, 35: an off-host hop that dead-ends is a failure", () => {
  test("the walk fails rather than stepping back to the aggregator", async () => {
    const page = fakeResolutionPage([
      {
        url: "https://board.example/listing/1",
        html: applyLink("https://employer.example/careers/9"),
      },
      { url: "https://employer.example/careers/9", html: '<input type="password">' },
    ]);

    expect(
      await resolveJobUrl("https://board.example/listing/1", page, { settle: NO_WAIT }),
    ).toEqual({ outcome: "failed", reason: "dead_end" });
  });
});

describe("AC 41, 42, 43: the four-hop ceiling", () => {
  // Four pages, each on its own host, each offering a link to the next. The
  // script holds exactly four, so a fifth goto would throw — which is how the
  // test proves the walk loaded no more than four pages.
  const fourSiteLinkChain = () => [
    { url: "https://a.example/1", html: applyLink("https://b.example/1") },
    { url: "https://b.example/1", html: applyLink("https://c.example/1") },
    { url: "https://c.example/1", html: applyLink("https://d.example/1") },
    { url: "https://d.example/1", html: applyLink("https://e.example/1") },
  ];

  test("a walk loads no more than four pages, and an unreached off-host link fails it", async () => {
    const page = fakeResolutionPage(fourSiteLinkChain());

    expect(await resolveJobUrl("https://a.example/1", page, { settle: NO_WAIT })).toEqual({
      outcome: "failed",
      reason: "page_limit_reached",
    });
  });

  test("a same-host link left unfollowed at the ceiling resolves where the walk stands", async () => {
    const script = fourSiteLinkChain();
    script[3] = { url: "https://d.example/1", html: applyLink("https://d.example/1/apply") };
    const page = fakeResolutionPage(script);

    expect(await resolveJobUrl("https://a.example/1", page, { settle: NO_WAIT })).toEqual({
      outcome: "resolved",
      resolvedUrl: "https://d.example/1",
      reason: "page_limit_reached",
    });
  });
});
