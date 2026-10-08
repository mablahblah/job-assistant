import { describe, expect, test } from "vitest";
import { resolveJobUrl } from "../resolvers/resolve-job-url";
import { fakeResolutionBrowser } from "./resolution-browser.fake";

// Every link carries a port, the way a link to the stand-in website does. The
// stand-in browser finds its page by host and path alone.
const PORT = 4321;
const linkTo = (hostAndPath: string) => {
  const slash = hostAndPath.indexOf("/");
  return `http://${hostAndPath.slice(0, slash)}:${PORT}${hostAndPath.slice(slash)}`;
};

const POSTING = "<h1>Product Designer</h1><p>Design the tools our freight teams use every day.</p>";

const pages = {
  "careers.dunmore.example/jobs/1": { body: POSTING },
  "board.example/listing/9": { redirectTo: linkTo("careers.dunmore.example/jobs/1") },
  "board.example/listing/10": {
    body: `<p>Product Designer at Dunmore</p><a href="${linkTo("careers.dunmore.example/jobs/1")}">Apply now</a>`,
  },
  "careers.dunmore.example/jobs/refused": { status: 403, body: "Access denied" },
  "careers.dunmore.example/jobs/sign-in": { status: 401, body: "Please sign in" },
  "careers.dunmore.example/jobs/hangs": { hang: true },
};

// One job's link followed through the stand-in, the way the resolution step
// follows it: a page opened from the browser, closed when done.
async function follow(link: string, browser = fakeResolutionBrowser(pages)) {
  const session = await browser();
  const opened = await session.openPage();
  try {
    return await resolveJobUrl(link, opened.page, { waitForLoad: async () => {} });
  } finally {
    await opened.close();
    await session.close();
  }
}

describe("fakeResolutionBrowser: a link is followed through the pages a test names", () => {
  test("a named page is the posting it lands on", async () => {
    const link = linkTo("careers.dunmore.example/jobs/1");
    expect(await follow(link)).toEqual({
      outcome: "resolved",
      resolvedUrl: link,
      reason: "no_apply_links",
    });
  });

  test("a redirect lands on its target", async () => {
    expect(await follow(linkTo("board.example/listing/9"))).toMatchObject({
      outcome: "resolved",
      resolvedUrl: linkTo("careers.dunmore.example/jobs/1"),
    });
  });

  test("an apply link on the page is followed", async () => {
    expect(await follow(linkTo("board.example/listing/10"))).toEqual({
      outcome: "resolved",
      resolvedUrl: linkTo("careers.dunmore.example/jobs/1"),
      reason: "link_left_site",
    });
  });

  test("a page answering 403 refuses to be followed", async () => {
    expect(await follow(linkTo("careers.dunmore.example/jobs/refused"))).toEqual({
      outcome: "failed",
      reason: "page_refused",
    });
  });

  test("a page answering 401 cannot be followed", async () => {
    expect(await follow(linkTo("careers.dunmore.example/jobs/sign-in"))).toEqual({
      outcome: "failed",
      reason: "page_unavailable",
    });
  });

  test("a page nobody named answers not found", async () => {
    expect(await follow(linkTo("elsewhere.example/anything"))).toEqual({
      outcome: "failed",
      reason: "page_unavailable",
    });
  });

  test("a page that hangs fails to load", async () => {
    expect(await follow(linkTo("careers.dunmore.example/jobs/hangs"))).toEqual({
      outcome: "failed",
      reason: "page_load_failed",
    });
  });

  test("each page asked for is recorded by host and path, without its port", async () => {
    const browser = fakeResolutionBrowser(pages);
    await follow(linkTo("board.example/listing/9?ref=feed"), browser);
    expect(browser.visits).toEqual(["board.example/listing/9?ref=feed"]);
  });
});
