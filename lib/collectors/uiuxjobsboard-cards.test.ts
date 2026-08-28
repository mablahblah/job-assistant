import { describe, expect, test } from "vitest";
import { UIUX_RESULTS_CONTAINER, readUiuxCards } from "./uiuxjobsboard-cards";
import { readFixture } from "./fixture";
import { parseAgeToDays } from "../job-age";

// The results list is built from small typed pieces rather than long
// literals, so each test states only the one thing it is proving.

interface CardOptions {
  href?: string;
  title?: string;
  company?: string;
  age?: string;
  featured?: boolean;
}

const DEFAULT_HREF = "/job/1581226-foundational-design-role-london-united-kingdom";
const DEFAULT_TITLE = "Foundational Design Role";
const DEFAULT_COMPANY = "Clera";
const DEFAULT_AGE = "15h";

// One job card the way UI/UX Jobs Board's results list renders it. An empty
// string for href, title, or age leaves that element out of the markup, the
// way a real card missing that piece would. A featured card carries a badge
// where the age belongs, the way a paid advertisement does.
function uiuxCard(options: CardOptions = {}): string {
  const {
    href = DEFAULT_HREF,
    title = DEFAULT_TITLE,
    company = DEFAULT_COMPANY,
    age = DEFAULT_AGE,
    featured = false,
  } = options;
  const linkOpen = href === "" ? "" : `<a class="inline-flex flex-col" href="${href}" data-discover="true">`;
  const linkClose = href === "" ? "" : "</a>";
  const companyHtml = `<span class="text-xl flex items-center gap-2 justify-center sm:justify-start"><span>${company}<span class="text-base opacity-40 ml-1">is hiring</span></span></span>`;
  const titleHtml = title === "" ? "" : `<span class="text-2xl text-primaryColor font-bold">${title}</span>`;
  const badge =
    '<span class="font-bold text-sm text-yellow-900 bg-yellow-300 py-1 px-2 rounded-sm select-none">★ Featured</span>';
  const ageHtml = featured ? badge : age;
  return `<div class="border shadow-xs rounded-xl flex flex-col sm:flex-row items-center justify-between gap-5 p-6 my-2 text-center sm:text-left bg-gray-50 border-gray-200 order-2">
    <div>
      <h3 class="w-full sm:w-112.5 wrap-break-word">
        ${linkOpen}
        ${companyHtml}
        ${titleHtml}
        ${linkClose}
      </h3>
      <span class="text-xs uppercase opacity-80 mr-3">Full Time</span>
      <span class="text-xs uppercase opacity-80">$150,000</span>
    </div>
    <div class="flex flex-wrap items-center justify-start flex-1 gap-2 uppercase text-xs font-bold text-secondaryDark">
      <a href="/design-jobs/london">London</a><a href="/design-jobs/united-kingdom">United Kingdom</a>
    </div>
    <div class="text-sm">${ageHtml}</div>
  </div>`;
}

// Wraps a set of card strings in the container the module reads from.
function uiuxResultsHtml(cards: string[]): string {
  return `<div class="max-w-225 flex flex-col mx-auto">${cards.join("")}</div>`;
}

describe("the results container selector", () => {
  test("targets the container the collector pulls and saves", () => {
    expect(UIUX_RESULTS_CONTAINER).toBe("div.max-w-225.flex.flex-col.mx-auto");
  });
});

describe("a normal card yields a title, an age, and an absolute url", () => {
  test("title is the span.text-2xl's text, trimmed", () => {
    const result = readUiuxCards(uiuxResultsHtml([uiuxCard()]));

    expect(result.cards[0].title).toBe(DEFAULT_TITLE);
  });

  test("age is the text-sm div's text, trimmed", () => {
    const result = readUiuxCards(uiuxResultsHtml([uiuxCard()]));

    expect(result.cards[0].age).toBe(DEFAULT_AGE);
  });
});

describe("the title comes from span.text-2xl, not the h3 that wraps the whole link", () => {
  // The h3's text runs the company, "is hiring", and the title together as
  // one string, so a title pulled from the wrong element would carry both.

  test("a card with a company name yields a title excluding the company and 'is hiring'", () => {
    const result = readUiuxCards(
      uiuxResultsHtml([uiuxCard({ company: "Vantheon", title: "Founding Product Designer" })])
    );

    expect(result.cards[0].title).toBe("Founding Product Designer");
    expect(result.cards[0].title).not.toContain("Vantheon");
    expect(result.cards[0].title).not.toContain("is hiring");
  });
});

describe("the url is built by prefixing a relative href with the uiuxjobsboard domain", () => {
  test("a relative href with no query becomes an absolute url unchanged otherwise", () => {
    const result = readUiuxCards(uiuxResultsHtml([uiuxCard({ href: "/job/42-some-job" })]));

    expect(result.cards[0].url).toBe("https://uiuxjobsboard.com/job/42-some-job");
  });
});

describe("a query string on the href is stripped", () => {
  test("an href carrying a query loses it once prefixed", () => {
    const result = readUiuxCards(uiuxResultsHtml([uiuxCard({ href: "/job/42-some-job?ref=index" })]));

    expect(result.cards[0].url).toBe("https://uiuxjobsboard.com/job/42-some-job");
  });
});

describe("an href that is already absolute is not prefixed a second time", () => {
  test("the url is the href verbatim, not doubled", () => {
    const result = readUiuxCards(
      uiuxResultsHtml([uiuxCard({ href: "https://uiuxjobsboard.com/job/999-already-absolute" })])
    );

    expect(result.cards[0].url).toBe("https://uiuxjobsboard.com/job/999-already-absolute");
  });
});

describe("cards come back in document order", () => {
  test("three cards read out in the order they appear in the html", () => {
    const first = uiuxCard({ href: "/job/1", title: "First Card" });
    const second = uiuxCard({ href: "/job/2", title: "Second Card" });
    const third = uiuxCard({ href: "/job/3", title: "Third Card" });

    const result = readUiuxCards(uiuxResultsHtml([first, second, third]));

    expect(result.cards.map((c) => c.title)).toEqual(["First Card", "Second Card", "Third Card"]);
  });
});

describe("a paid advertisement is skipped entirely", () => {
  // A featured card carries a badge in its age slot instead of an age, so it
  // can never be aged and must not reach the caller or be counted.

  test("a card whose age slot holds 'Featured' is absent from cards", () => {
    const normal = uiuxCard({ title: "Real Job" });
    const ad = uiuxCard({ featured: true, title: "Sponsored Job" });

    const result = readUiuxCards(uiuxResultsHtml([ad, normal]));

    expect(result.cards.map((c) => c.title)).toEqual(["Real Job"]);
  });

  test("an ad counts in neither cards nor matched", () => {
    const result = readUiuxCards(uiuxResultsHtml([uiuxCard({ featured: true })]));

    expect(result.cards).toEqual([]);
    expect(result.matched).toBe(0);
  });
});

describe("matched counts every non-ad card, whether or not it yielded a card", () => {
  test("a broken card still adds to matched even though it adds nothing to cards", () => {
    const good = uiuxCard({ title: "Good Card" });
    const brokenHref = uiuxCard({ href: "" });

    const result = readUiuxCards(uiuxResultsHtml([good, brokenHref]));

    expect(result.cards).toHaveLength(1);
    expect(result.matched).toBe(2);
  });

  test("an ad among broken and good cards is left out of the matched total", () => {
    const good = uiuxCard({ title: "Good Card" });
    const brokenTitle = uiuxCard({ title: "" });
    const ad = uiuxCard({ featured: true });

    const result = readUiuxCards(uiuxResultsHtml([ad, good, brokenTitle]));

    expect(result.matched).toBe(2);
  });

  test("a mix of broken and whole cards leaves matched larger than cards read", () => {
    const result = readUiuxCards(
      uiuxResultsHtml([
        uiuxCard(),
        uiuxCard({ href: "" }),
        uiuxCard({ title: "" }),
        uiuxCard({ age: "" }),
        uiuxCard({ featured: true }),
      ])
    );

    expect(result.cards).toHaveLength(1);
    expect(result.matched).toBe(4);
  });
});

describe("a card missing its link yields no card but still counts as matched", () => {
  test("cards is empty", () => {
    expect(readUiuxCards(uiuxResultsHtml([uiuxCard({ href: "" })])).cards).toEqual([]);
  });

  test("matched is one", () => {
    expect(readUiuxCards(uiuxResultsHtml([uiuxCard({ href: "" })])).matched).toBe(1);
  });
});

describe("a card missing its title yields no card but still counts as matched", () => {
  test("cards is empty", () => {
    expect(readUiuxCards(uiuxResultsHtml([uiuxCard({ title: "" })])).cards).toEqual([]);
  });

  test("matched is one", () => {
    expect(readUiuxCards(uiuxResultsHtml([uiuxCard({ title: "" })])).matched).toBe(1);
  });
});

describe("a card missing its age yields no card but still counts as matched", () => {
  // A job with no date can never be aged, so it is not worth returning.

  test("cards is empty", () => {
    expect(readUiuxCards(uiuxResultsHtml([uiuxCard({ age: "" })])).cards).toEqual([]);
  });

  test("matched is one", () => {
    expect(readUiuxCards(uiuxResultsHtml([uiuxCard({ age: "" })])).matched).toBe(1);
  });
});

describe("html holding no cards returns an empty result instead of throwing", () => {
  test("an empty results container yields no cards", () => {
    expect(readUiuxCards(uiuxResultsHtml([])).cards).toEqual([]);
  });

  test("an empty results container matches nothing", () => {
    expect(readUiuxCards(uiuxResultsHtml([])).matched).toBe(0);
  });

  test("an empty string does not throw", () => {
    expect(() => readUiuxCards("")).not.toThrow();
  });

  test("an empty string yields no cards", () => {
    expect(readUiuxCards("").cards).toEqual([]);
  });

  test("an empty string matches nothing", () => {
    expect(readUiuxCards("").matched).toBe(0);
  });
});

describe("whitespace around the title and age is trimmed", () => {
  test("a padded title and age both come back clean", () => {
    const padded = uiuxCard({ title: "  Foundational Design Role  ", age: "  15h  " });

    const result = readUiuxCards(uiuxResultsHtml([padded]));

    expect(result.cards[0].title).toBe("Foundational Design Role");
    expect(result.cards[0].age).toBe("15h");
  });
});

describe("the committed fixture", () => {
  // The fixture is refreshed by real runs, so these assert structure rather
  // than a specific count of cards or advertisements.

  test("yields at least one card", () => {
    expect(readUiuxCards(readFixture("uiuxjobsboard")).cards.length).toBeGreaterThan(0);
  });

  test("every card has a title, an age, and a url pointing at a uiuxjobsboard job", () => {
    const result = readUiuxCards(readFixture("uiuxjobsboard"));

    for (const resultCard of result.cards) {
      expect(resultCard.title.length).toBeGreaterThan(0);
      expect(resultCard.age.length).toBeGreaterThan(0);
      expect(resultCard.url.startsWith("https://uiuxjobsboard.com/job/")).toBe(true);
    }
  });

  test("matched is at least as large as the number of cards", () => {
    const result = readUiuxCards(readFixture("uiuxjobsboard"));

    expect(result.matched).toBeGreaterThanOrEqual(result.cards.length);
  });

  test("every card's age is readable by parseAgeToDays", () => {
    // Catches the site rewording its date labels before a collector run does.
    const result = readUiuxCards(readFixture("uiuxjobsboard"));

    for (const resultCard of result.cards) {
      expect(parseAgeToDays(resultCard.age)).not.toBeNull();
    }
  });

  test("no card's title carries the words 'is hiring'", () => {
    // Proves the title came from span.text-2xl and not the h3, which runs
    // the company, "is hiring", and the title together as one string.
    const result = readUiuxCards(readFixture("uiuxjobsboard"));

    for (const resultCard of result.cards) {
      expect(resultCard.title).not.toContain("is hiring");
    }
  });
});
