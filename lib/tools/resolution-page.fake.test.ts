import { describe, expect, test } from "vitest";
import type { ResolutionPage, ResolutionResponse } from "./resolution-page";
import { fakeResolutionPage } from "./resolution-page.fake";

// How resolution reads a page's links: every anchor, with its href resolved the
// way a browser resolves it and its text trimmed. It reads `href` rather than
// the href attribute because a browser resolves the first and leaves the
// second relative, and resolution compares hosts.
function readLinks(page: ResolutionPage) {
  return page.$$eval("a", (elements) =>
    elements.map((element) => ({
      href: element.href ?? "",
      text: element.textContent?.trim() ?? "",
    })),
  );
}

describe("the fake satisfies the interface resolution is written against", () => {
  test("it is a ResolutionPage", () => {
    const page: ResolutionPage = fakeResolutionPage([{ url: "https://example.com/a" }]);
    expect(page).toBeTypeOf("object");
  });
});

describe("the script is resolved one page per goto, in order", () => {
  test("the first goto serves the first scripted page", async () => {
    const page = fakeResolutionPage([
      { url: "https://board.example/listing/1" },
      { url: "https://employer.example/careers/9" },
    ]);

    await page.goto("https://board.example/listing/1");

    expect(page.url()).toBe("https://board.example/listing/1");
  });

  test("the next goto serves the next scripted page, whatever URL it is given", async () => {
    const page = fakeResolutionPage([
      { url: "https://board.example/listing/1" },
      { url: "https://employer.example/careers/9" },
    ]);

    await page.goto("https://board.example/listing/1");
    await page.goto("https://redirector.example/out");

    expect(page.url()).toBe("https://employer.example/careers/9");
  });

  test("a goto past the end of the script throws, because the test ran out of pages", async () => {
    const page = fakeResolutionPage([{ url: "https://board.example/listing/1" }]);

    await page.goto("https://board.example/listing/1");

    await expect(page.goto("https://board.example/listing/2")).rejects.toThrow(
      /script/i,
    );
  });
});

describe("the settled URL is the one the page reports", () => {
  test("a page that jumps client-side reports where it ended, not where it was sent", async () => {
    const page = fakeResolutionPage([
      {
        url: "https://employer.example/careers/9",
        responses: [
          { url: "https://redirector.example/out", status: 200 },
          { url: "https://employer.example/careers/9", status: 403 },
        ],
      },
    ]);

    await page.goto("https://redirector.example/out");

    expect(page.url()).toBe("https://employer.example/careers/9");
  });
});

describe("goto hands back the response the navigation itself produced", () => {
  test("a page with no responses scripted answers 200 at its own URL", async () => {
    const page = fakeResolutionPage([{ url: "https://employer.example/careers/9" }]);

    const response = await page.goto("https://employer.example/careers/9");

    expect(response?.status()).toBe(200);
    expect(response?.url()).toBe("https://employer.example/careers/9");
  });

  test("the status is the first scripted response, not the last", async () => {
    const page = fakeResolutionPage([
      {
        url: "https://employer.example/careers/9",
        responses: [
          { url: "https://redirector.example/out", status: 200 },
          { url: "https://employer.example/careers/9", status: 403 },
        ],
      },
    ]);

    const response = await page.goto("https://redirector.example/out");

    expect(response?.status()).toBe(200);
  });
});

describe("the responses a page fetches for itself reach a listener", () => {
  test("every scripted response is handed to a registered handler", async () => {
    const page = fakeResolutionPage([
      {
        url: "https://employer.example/careers/9",
        responses: [
          { url: "https://redirector.example/out", status: 200 },
          { url: "https://employer.example/careers/9", status: 403 },
        ],
      },
    ]);
    const seen: number[] = [];
    page.on("response", (response: ResolutionResponse) => seen.push(response.status()));

    await page.goto("https://redirector.example/out");

    expect(seen).toEqual([200, 403]);
  });

  // A real page load fires the document plus its images, scripts and
  // advertising pixels. Resolution counts a refusal only on a document, so a
  // scripted response has to be able to say which it was.
  test("a scripted response is a navigation unless it says otherwise", async () => {
    const page = fakeResolutionPage([
      {
        url: "https://employer.example/careers/9",
        responses: [
          { url: "https://employer.example/careers/9", status: 200 },
          { url: "https://tracker.example/pixel.gif", status: 403, isNavigation: false },
        ],
      },
    ]);
    const seen: boolean[] = [];
    page.on("response", (response: ResolutionResponse) =>
      seen.push(response.request().isNavigationRequest()),
    );

    await page.goto("https://employer.example/careers/9");

    expect(seen).toEqual([true, false]);
  });

  test("a handler removed with off hears nothing further", async () => {
    const page = fakeResolutionPage([
      { url: "https://a.example/1" },
      { url: "https://b.example/2" },
    ]);
    const seen: number[] = [];
    const handler = (response: ResolutionResponse) => seen.push(response.status());
    page.on("response", handler);

    await page.goto("https://a.example/1");
    page.off("response", handler);
    await page.goto("https://b.example/2");

    expect(seen).toEqual([200]);
  });
});

describe("a page the browser cannot load at all", () => {
  test("goto rejects when the scripted page fails to load", async () => {
    const page = fakeResolutionPage([
      { url: "https://employer.example/careers/9", failsToLoad: true },
    ]);

    await expect(page.goto("https://employer.example/careers/9")).rejects.toThrow();
  });
});

describe("the page's content is what the script gave it", () => {
  test("content returns the scripted HTML", async () => {
    const page = fakeResolutionPage([
      { url: "https://a.example/1", html: "<p>Senior Product Designer</p>" },
    ]);

    await page.goto("https://a.example/1");

    expect(await page.content()).toBe("<p>Senior Product Designer</p>");
  });

  test("a page scripted with no HTML has none", async () => {
    const page = fakeResolutionPage([{ url: "https://a.example/1" }]);

    await page.goto("https://a.example/1");

    expect(await page.content()).toBe("");
  });

  test("title returns the scripted title, and an empty string when none was given", async () => {
    const page = fakeResolutionPage([
      { url: "https://a.example/1", title: "Senior Product Designer" },
      { url: "https://a.example/2" },
    ]);

    await page.goto("https://a.example/1");
    expect(await page.title()).toBe("Senior Product Designer");

    await page.goto("https://a.example/2");
    expect(await page.title()).toBe("");
  });
});

describe("the page's links are read out of its HTML", () => {
  test("a relative href is resolved against the page's own URL, as a browser would", async () => {
    const page = fakeResolutionPage([
      {
        url: "https://board.example/listing/1",
        html: '<a href="/jobs/9">Apply Now</a>',
      },
    ]);

    await page.goto("https://board.example/listing/1");

    expect(await readLinks(page)).toEqual([
      { href: "https://board.example/jobs/9", text: "Apply Now" },
    ]);
  });

  test("an absolute href is left as it stands", async () => {
    const page = fakeResolutionPage([
      {
        url: "https://board.example/listing/1",
        html: '<a href="https://employer.example/careers/9">View Job</a>',
      },
    ]);

    await page.goto("https://board.example/listing/1");

    expect(await readLinks(page)).toEqual([
      { href: "https://employer.example/careers/9", text: "View Job" },
    ]);
  });

  test("an anchor with no href reads as an empty href, the way a modal trigger does", async () => {
    const page = fakeResolutionPage([
      { url: "https://board.example/listing/1", html: "<a>Apply</a>" },
    ]);

    await page.goto("https://board.example/listing/1");

    expect(await readLinks(page)).toEqual([{ href: "", text: "Apply" }]);
  });

  test("a page with no links at all reads as none", async () => {
    const page = fakeResolutionPage([
      { url: "https://board.example/listing/1", html: "<p>Nothing to follow</p>" },
    ]);

    await page.goto("https://board.example/listing/1");

    expect(await readLinks(page)).toEqual([]);
  });
});

describe("a page can change between reads, the way a page finishes rendering", () => {
  test("advancing serves the page's next render", async () => {
    const page = fakeResolutionPage([
      {
        url: "https://board.example/listing/1",
        becomes: [{ title: "Senior Product Designer" }],
      },
    ]);

    await page.goto("https://board.example/listing/1");
    expect(await page.title()).toBe("");

    page.advance();

    expect(await page.title()).toBe("Senior Product Designer");
  });
});
