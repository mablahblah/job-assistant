import { describe, expect, test } from "vitest";
import { fakeResolutionPage } from "./resolution-page.fake";
import { resolveJobUrl } from "./resolve-job-url";

// Settling is its own module with its own tests. Most resolutions here are scripted
// as already-finished pages, so resolution is handed a waitForLoad that does nothing
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
      await resolveJobUrl("https://employer.example/careers/9", page, { waitForLoad: NO_WAIT }),
    ).toEqual({
      outcome: "resolved",
      resolvedUrl: "https://employer.example/careers/9",
      reason: "no_apply_links",
    });
  });
});

describe("AC 7, 8, 9, 11: a page that does not succeed is never a destination", () => {
  test("a 403 is a refusal, which the source may lift on a later run", async () => {
    const page = fakeResolutionPage([
      {
        url: "https://board.example/listing/1",
        responses: [{ url: "https://board.example/listing/1", status: 403 }],
      },
    ]);

    expect(
      await resolveJobUrl("https://board.example/listing/1", page, { waitForLoad: NO_WAIT }),
    ).toEqual({ outcome: "failed", reason: "page_refused" });
  });

  test("a 429 is a refusal, being the source saying we asked too often", async () => {
    const page = fakeResolutionPage([
      {
        url: "https://board.example/listing/1",
        responses: [{ url: "https://board.example/listing/1", status: 429 }],
      },
    ]);

    expect(
      await resolveJobUrl("https://board.example/listing/1", page, { waitForLoad: NO_WAIT }),
    ).toEqual({ outcome: "failed", reason: "page_refused" });
  });

  test("a 503 is a refusal, the server being unwell rather than the page gone", async () => {
    const page = fakeResolutionPage([
      {
        url: "https://board.example/listing/1",
        responses: [{ url: "https://board.example/listing/1", status: 503 }],
      },
    ]);

    expect(
      await resolveJobUrl("https://board.example/listing/1", page, { waitForLoad: NO_WAIT }),
    ).toEqual({ outcome: "failed", reason: "page_refused" });
  });

  test("a 401 is the page being unavailable, since no later run gets a login", async () => {
    const page = fakeResolutionPage([
      {
        url: "https://board.example/listing/1",
        responses: [{ url: "https://board.example/listing/1", status: 401 }],
      },
    ]);

    expect(
      await resolveJobUrl("https://board.example/listing/1", page, { waitForLoad: NO_WAIT }),
    ).toEqual({ outcome: "failed", reason: "page_unavailable" });
  });

  test("a 404 fails resolution even where the page still renders a job title", async () => {
    const page = fakeResolutionPage([
      {
        url: "https://board.example/listing/1",
        title: "Senior Product Designer",
        responses: [{ url: "https://board.example/listing/1", status: 404 }],
      },
    ]);

    expect(
      await resolveJobUrl("https://board.example/listing/1", page, { waitForLoad: NO_WAIT }),
    ).toEqual({ outcome: "failed", reason: "page_unavailable" });
  });
});

describe("AC 10: a page the browser cannot load at all", () => {
  test("a goto that throws is a load failure rather than a bad status", async () => {
    const page = fakeResolutionPage([
      { url: "https://board.example/listing/1", failsToLoad: true },
    ]);

    expect(
      await resolveJobUrl("https://board.example/listing/1", page, { waitForLoad: NO_WAIT }),
    ).toEqual({ outcome: "failed", reason: "page_load_failed" });
  });
});

describe("AC 11a: the status read is the status of the page ended on", () => {
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
      await resolveJobUrl("https://redirector.example/out", page, { waitForLoad: NO_WAIT }),
    ).toEqual({ outcome: "failed", reason: "page_refused" });
  });
});

describe("AC 16, 17, 21, 21a: the blacklist is checked on the settled URL", () => {
  test("a job's resolution reaching a blacklisted host is marked blacklisted", async () => {
    const page = fakeResolutionPage([{ url: "https://jobleads.com/job/1" }]);

    expect(
      await resolveJobUrl("https://jobleads.com/job/1", page, { waitForLoad: NO_WAIT }),
    ).toEqual({ outcome: "blacklisted" });
  });

  test("a page that jumps to a blacklisted host while waiting for the page to load is caught", async () => {
    const page = fakeResolutionPage([
      {
        url: "https://board.example/listing/1",
        becomes: [{ url: "https://jobleads.com/job/1" }],
      },
    ]);

    expect(
      await resolveJobUrl("https://board.example/listing/1", page, {
        waitForLoad: async () => {
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
      await resolveJobUrl("https://jobleads.com/job/1", page, { waitForLoad: NO_WAIT }),
    ).toEqual({ outcome: "blacklisted" });
  });
});

describe("AC 26, 27, 28, 30: a same-host page that ends resolution is discarded", () => {
  test("a same-host apply link is followed rather than treated as an arrival", async () => {
    const page = fakeResolutionPage([
      {
        url: "https://employer.example/careers/9",
        html: applyLink("https://employer.example/careers/9/apply"),
      },
      { url: "https://employer.example/careers/9/apply", html: "<p>Application form</p>" },
    ]);

    expect(
      await resolveJobUrl("https://employer.example/careers/9", page, { waitForLoad: NO_WAIT }),
    ).toEqual({
      outcome: "resolved",
      resolvedUrl: "https://employer.example/careers/9",
      reason: "stayed_on_site",
    });
  });

  test("a same-host page landing on a dead end is discarded too", async () => {
    const page = fakeResolutionPage([
      {
        url: "https://employer.example/careers/9",
        html: applyLink("https://employer.example/careers/9/apply"),
      },
      { url: "https://employer.example/careers/9/apply", html: '<input type="password">' },
    ]);

    expect(
      await resolveJobUrl("https://employer.example/careers/9", page, { waitForLoad: NO_WAIT }),
    ).toEqual({
      outcome: "resolved",
      resolvedUrl: "https://employer.example/careers/9",
      reason: "stayed_on_site",
    });
  });
});

describe("AC 29: a same-host page that leads onward keeps its place", () => {
  test("the page stands and resolution carries on from where it ended", async () => {
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
      await resolveJobUrl("https://aggregator.example/listing/1", page, { waitForLoad: NO_WAIT }),
    ).toEqual({
      outcome: "resolved",
      resolvedUrl: "https://employer.example/careers/9",
      reason: "link_left_site",
    });
  });
});

describe("AC 31, 32: a page is judged by where it ended, not by its href", () => {
  test("a same-host href that redirects away is judged off-host", async () => {
    const page = fakeResolutionPage([
      {
        url: "https://board.example/listing/1",
        html: applyLink("https://board.example/out/9"),
      },
      { url: "https://employer.example/careers/9", html: "<p>A job posting</p>" },
    ]);

    expect(
      await resolveJobUrl("https://board.example/listing/1", page, { waitForLoad: NO_WAIT }),
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
      await resolveJobUrl("https://board.example/listing/1", page, { waitForLoad: NO_WAIT }),
    ).toEqual({
      outcome: "resolved",
      resolvedUrl: "https://board.example/listing/1",
      reason: "stayed_on_site",
    });
  });
});

describe("AC 34, 35: an off-host page that dead-ends is a failure", () => {
  test("resolution fails rather than stepping back to the aggregator", async () => {
    const page = fakeResolutionPage([
      {
        url: "https://board.example/listing/1",
        html: applyLink("https://employer.example/careers/9"),
      },
      { url: "https://employer.example/careers/9", html: '<input type="password">' },
    ]);

    expect(
      await resolveJobUrl("https://board.example/listing/1", page, { waitForLoad: NO_WAIT }),
    ).toEqual({ outcome: "failed", reason: "dead_end" });
  });
});

describe("AC 41, 42, 43: the four-page limit", () => {
  // Four pages, each on its own host, each offering a link to the next. The
  // script holds exactly four, so a fifth goto would throw — which is how the
  // test proves resolution loaded no more than four pages.
  const fourSiteLinkChain = () => [
    { url: "https://a.example/1", html: applyLink("https://b.example/1") },
    { url: "https://b.example/1", html: applyLink("https://c.example/1") },
    { url: "https://c.example/1", html: applyLink("https://d.example/1") },
    { url: "https://d.example/1", html: applyLink("https://e.example/1") },
  ];

  test("a job's resolution loads no more than four pages, and an unreached off-host link fails it", async () => {
    const page = fakeResolutionPage(fourSiteLinkChain());

    expect(await resolveJobUrl("https://a.example/1", page, { waitForLoad: NO_WAIT })).toEqual({
      outcome: "failed",
      reason: "page_limit_reached",
    });
  });

  test("a same-host link left unfollowed at the ceiling resolves where resolution stands", async () => {
    const script = fourSiteLinkChain();
    script[3] = { url: "https://d.example/1", html: applyLink("https://d.example/1/apply") };
    const page = fakeResolutionPage(script);

    expect(await resolveJobUrl("https://a.example/1", page, { waitForLoad: NO_WAIT })).toEqual({
      outcome: "resolved",
      resolvedUrl: "https://d.example/1",
      reason: "page_limit_reached",
    });
  });
});

// Measured on a real run: a job from uiuxjobsboard ended on
// https://job-boards.greenhouse.io/gusto?error=true, which answers 200 and
// renders Gusto's whole board — 95 jobs on one page. It was saved as the
// posting. The address is the only host-free evidence that the job id is gone,
// so the rule reads the address rather than naming a board.
describe("a page whose own address says the posting is gone is not a destination", () => {
  test("an off-site page carrying an error flag fails rather than resolving", async () => {
    const page = fakeResolutionPage([
      { url: "https://board.example/listing/1", html: applyLink("https://ats.example/acme/1") },
      { url: "https://ats.example/acme?error=true", html: "<p>95 jobs</p>" },
    ]);

    expect(
      await resolveJobUrl("https://board.example/listing/1", page, { waitForLoad: NO_WAIT }),
    ).toEqual({ outcome: "failed", reason: "posting_gone" });
  });

  test("the same address without the flag resolves as it did before", async () => {
    const page = fakeResolutionPage([
      { url: "https://board.example/listing/1", html: applyLink("https://ats.example/acme/1") },
      { url: "https://ats.example/acme/1", html: "<p>One posting</p>" },
    ]);

    expect(
      await resolveJobUrl("https://board.example/listing/1", page, { waitForLoad: NO_WAIT }),
    ).toEqual({
      outcome: "resolved",
      resolvedUrl: "https://ats.example/acme/1",
      reason: "link_left_site",
    });
  });

  test("the first page carrying the flag fails too, before anything is followed", async () => {
    const page = fakeResolutionPage([
      { url: "https://ats.example/acme?error=true", html: applyLink("https://ats.example/apply") },
    ]);

    expect(
      await resolveJobUrl("https://ats.example/acme?error=true", page, { waitForLoad: NO_WAIT }),
    ).toEqual({ outcome: "failed", reason: "posting_gone" });
  });
});

// Phase 8b, AC 48, 49, 50. Found live on 2026-09-12: a run recorded no refusal
// for Adzuna while full-page 403s were watched going past on screen. An Adzuna
// link redirects at once to a second address carrying a token, that address
// answers 403, and the browser is then sent somewhere that answers 200.
// Reading only the address the page settled on misses the refusal entirely, so
// the host is never slowed down.
describe("phase 8b AC 48, 49, 50: a refusal partway through the chain", () => {
  test("a chain refused before it settles somewhere successful is still a refusal", async () => {
    const page = fakeResolutionPage([
      {
        url: "https://www.adzuna.example/details/1",
        html: "<p>A job posting</p>",
        responses: [
          { url: "https://www.adzuna.example/land/ad/1", status: 303 },
          { url: "https://www.adzuna.example/1?aztt=token", status: 403 },
          { url: "https://www.adzuna.example/details/1", status: 200 },
        ],
      },
    ]);

    expect(
      await resolveJobUrl("https://www.adzuna.example/land/ad/1", page, { waitForLoad: NO_WAIT }),
    ).toEqual({ outcome: "failed", reason: "page_refused" });
  });

  // One measured page load fired 69 responses, most of them trackers and
  // images. Counting any of those would send a working host to the slow lane
  // over an advertising pixel nobody needs.
  test("a refused response the browser never navigated to is not a refusal", async () => {
    const page = fakeResolutionPage([
      {
        url: "https://employer.example/careers/9",
        html: "<p>A job posting</p>",
        responses: [
          { url: "https://employer.example/careers/9", status: 200 },
          { url: "https://tracker.example/pixel.gif", status: 403, isNavigation: false },
        ],
      },
    ]);

    expect(
      await resolveJobUrl("https://employer.example/careers/9", page, { waitForLoad: NO_WAIT }),
    ).toEqual({
      outcome: "resolved",
      resolvedUrl: "https://employer.example/careers/9",
      reason: "no_apply_links",
    });
  });

  // A 404 partway through is not a refusal: the source answered, it simply had
  // nothing at that address. The address the page settled on still decides.
  test("a chain carrying no refused navigation is decided by where it settled", async () => {
    const page = fakeResolutionPage([
      {
        url: "https://employer.example/careers/9",
        html: "<p>A job posting</p>",
        responses: [
          { url: "https://redirector.example/gone", status: 404 },
          { url: "https://employer.example/careers/9", status: 200 },
        ],
      },
    ]);

    expect(
      await resolveJobUrl("https://redirector.example/gone", page, { waitForLoad: NO_WAIT }),
    ).toEqual({
      outcome: "resolved",
      resolvedUrl: "https://employer.example/careers/9",
      reason: "no_apply_links",
    });
  });
});
