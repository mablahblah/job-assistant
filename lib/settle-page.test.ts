import { describe, expect, test } from "vitest";
import type { PageAnchor, ResolutionPage } from "./resolution-page";
import { fakeResolutionPage } from "./resolution-page.fake";
import { settlePage } from "./settle-page";

// A page's anchors, as many as a test needs. A settled page carries five or
// more of them, so a test says "enough" or "not enough" by count alone.
function anchors(count: number): string {
  return Array.from(
    { length: count },
    (_, index) => `<a href="/jobs/${index}">Apply</a>`,
  ).join("");
}

describe("a page that already looks finished is not waited on", () => {
  test("settling returns without waiting once", async () => {
    const page = fakeResolutionPage([
      {
        url: "https://employer.example/careers/9",
        title: "Senior Product Designer",
        html: anchors(5),
      },
    ]);
    await page.goto("https://employer.example/careers/9");

    let waits = 0;
    await settlePage(page, {
      wait: async () => {
        waits += 1;
      },
    });

    expect(waits).toBe(0);
  });
});

describe("a page that is still going is given time", () => {
  test("a page that navigates away while settling is judged where it landed", async () => {
    const page = fakeResolutionPage([
      {
        url: "https://redirector.example/out",
        becomes: [
          {
            url: "https://employer.example/careers/9",
            title: "Senior Product Designer",
            html: anchors(5),
          },
        ],
      },
    ]);
    await page.goto("https://redirector.example/out");

    await settlePage(page, {
      wait: async () => {
        page.advance();
      },
    });

    expect(page.url()).toBe("https://employer.example/careers/9");
  });

  test("a page that renders in late is settled where it finished", async () => {
    const page = fakeResolutionPage([
      {
        url: "https://employer.example/careers/9",
        becomes: [{ title: "Senior Product Designer", html: anchors(5) }],
      },
    ]);
    await page.goto("https://employer.example/careers/9");

    await settlePage(page, {
      wait: async () => {
        page.advance();
      },
    });

    expect(await page.title()).toBe("Senior Product Designer");
  });
});

describe("a page that never settles is judged as it stands", () => {
  test("settling returns rather than throwing once the budget is spent", async () => {
    const page = fakeResolutionPage([{ url: "https://slow.example/1" }]);
    await page.goto("https://slow.example/1");

    // A clock the test drives: every wait moves it forward by the interval,
    // so the budget runs out after a known number of polls.
    let elapsed = 0;
    let waits = 0;

    await expect(
      settlePage(page, {
        budgetMs: 600,
        intervalMs: 200,
        now: () => elapsed,
        wait: async (ms) => {
          waits += 1;
          elapsed += ms;
        },
      }),
    ).resolves.toBeUndefined();

    expect(waits).toBeGreaterThan(0);
    expect(page.url()).toBe("https://slow.example/1");
  });
});

describe("a read that fails because the page moved is progress, not a failure", () => {
  test("settling carries on after a destroyed execution context", async () => {
    const page = fakeResolutionPage([
      {
        url: "https://redirector.example/out",
        becomes: [
          {
            url: "https://employer.example/careers/9",
            title: "Senior Product Designer",
            html: anchors(5),
          },
        ],
      },
    ]);
    await page.goto("https://redirector.example/out");

    // A real browser throws this out of $$eval when the page navigates
    // mid-read. The walk must read that as the page having moved on.
    let reads = 0;
    const navigatingPage: ResolutionPage = {
      ...page,
      async $$eval<T>(selector: string, fn: (elements: PageAnchor[]) => T): Promise<T> {
        reads += 1;
        if (reads === 1) {
          throw new Error(
            "Execution context was destroyed, most likely because of a navigation",
          );
        }
        return page.$$eval(selector, fn);
      },
    };

    await settlePage(navigatingPage, {
      wait: async () => {
        page.advance();
      },
    });

    expect(page.url()).toBe("https://employer.example/careers/9");
  });
});
