import { describe, expect, test } from "vitest";
import { DRIBBBLE_RESULTS_CONTAINER, readDribbbleCards } from "./dribbble-cards";
import { readFixture } from "./fixture";
import { parseAgeToDays } from "../job-age";

// The results list is built from small typed pieces rather than long
// literals, so each test states only the one thing it is proving.

interface CardOptions {
  href?: string;
  title?: string;
  age?: string;
  featured?: boolean;
}

const DEFAULT_HREF = "/jobs/309185-Founding-Product-Designer-Austin-TX?source=index";
const DEFAULT_TITLE = "Founding Product Designer (Austin, TX)";
const DEFAULT_AGE = "Posted 15 days ago";

// One job card the way Dribbble's results list renders it. An empty string
// for href, title, or age leaves that element out of the markup entirely,
// the way a real card missing that piece would.
function dribbbleCard(options: CardOptions = {}): string {
  const { href = DEFAULT_HREF, title = DEFAULT_TITLE, age = DEFAULT_AGE, featured = false } = options;
  const classes = featured
    ? "job-list-item  job-list-item--boosted job-list-item--featured"
    : "job-list-item ";
  const linkHtml = href === "" ? "" : `<a class="job-link" rel="nofollow" href="${href}"></a>`;
  const titleHtml = title === "" ? "" : `<h4 class="job-title job-board-job-title">${title}</h4>`;
  const ageHtml = age === "" ? "" : `<div class="posted-on hide-on-mobile">${age}</div>`;
  return `<li class="${classes}">
    ${linkHtml}
    <div class="job-details-container">
      <div class="job-title-company-container">
        <div class="job-role "><span class="job-board-job-company">Vantheon</span></div>
        ${titleHtml}
      </div>
    </div>
    <div class="job-additional-details-container">
      <div class="job-details">
        ${ageHtml}
        <div class="location-container"><span class="location">Austin, TX</span></div>
      </div>
    </div>
  </li>`;
}

// A card carrying exactly one of the two ad classes, so each is proven
// disqualifying on its own rather than only when they appear together.
function adCard(adClass: "job-list-item--boosted" | "job-list-item--featured"): string {
  return dribbbleCard().replace('class="job-list-item "', `class="job-list-item ${adClass}"`);
}

// Wraps a set of card strings in the container the module reads from.
function dribbbleResultsHtml(cards: string[]): string {
  return `<ol class="job-board-job-list">${cards.join("")}</ol>`;
}

describe("the results container selector", () => {
  test("targets the ordered job list the collector pulls and saves", () => {
    expect(DRIBBBLE_RESULTS_CONTAINER).toBe("ol.job-board-job-list");
  });
});

describe("a normal card yields a title, an age, and an absolute url", () => {
  test("title is the h4's text, trimmed", () => {
    const result = readDribbbleCards(dribbbleResultsHtml([dribbbleCard()]));

    expect(result.cards[0].title).toBe(DEFAULT_TITLE);
  });

  test("age is the posted-on text, trimmed", () => {
    const result = readDribbbleCards(dribbbleResultsHtml([dribbbleCard()]));

    expect(result.cards[0].age).toBe(DEFAULT_AGE);
  });
});

describe("the url is built by prefixing a relative href with the dribbble domain", () => {
  test("a relative href with no query becomes an absolute url unchanged otherwise", () => {
    const result = readDribbbleCards(
      dribbbleResultsHtml([dribbbleCard({ href: "/jobs/42-Some-Job" })])
    );

    expect(result.cards[0].url).toBe("https://dribbble.com/jobs/42-Some-Job");
  });
});

describe("the ?source=index query is stripped, since it is only search noise", () => {
  test("an href carrying ?source=index loses it once prefixed", () => {
    const result = readDribbbleCards(
      dribbbleResultsHtml([dribbbleCard({ href: "/jobs/42-Some-Job?source=index" })])
    );

    expect(result.cards[0].url).toBe("https://dribbble.com/jobs/42-Some-Job");
  });
});

describe("an href that is already absolute is not prefixed a second time", () => {
  test("the url is the href verbatim, not doubled", () => {
    const result = readDribbbleCards(
      dribbbleResultsHtml([dribbbleCard({ href: "https://dribbble.com/jobs/999-Already-Absolute" })])
    );

    expect(result.cards[0].url).toBe("https://dribbble.com/jobs/999-Already-Absolute");
  });
});

describe("cards come back in document order", () => {
  test("three cards read out in the order they appear in the html", () => {
    const first = dribbbleCard({ href: "/jobs/1", title: "First Card" });
    const second = dribbbleCard({ href: "/jobs/2", title: "Second Card" });
    const third = dribbbleCard({ href: "/jobs/3", title: "Third Card" });

    const result = readDribbbleCards(dribbbleResultsHtml([first, second, third]));

    expect(result.cards.map((c) => c.title)).toEqual(["First Card", "Second Card", "Third Card"]);
  });
});

describe("a paid advertisement is skipped entirely", () => {
  // Boosted and featured cards are pinned to the top of every search and
  // carry no date at all, so they must not reach the caller or be counted.

  test("a card carrying both ad classes is absent from cards", () => {
    const normal = dribbbleCard({ title: "Real Job" });
    const ad = dribbbleCard({ featured: true, title: "Sponsored Job" });

    const result = readDribbbleCards(dribbbleResultsHtml([ad, normal]));

    expect(result.cards.map((c) => c.title)).toEqual(["Real Job"]);
  });

  test("a card carrying only job-list-item--featured is skipped", () => {
    const result = readDribbbleCards(
      dribbbleResultsHtml([adCard("job-list-item--featured"), dribbbleCard({ title: "Real Job" })])
    );

    expect(result.cards.map((c) => c.title)).toEqual(["Real Job"]);
  });

  test("a card carrying only job-list-item--boosted is skipped", () => {
    const result = readDribbbleCards(
      dribbbleResultsHtml([adCard("job-list-item--boosted"), dribbbleCard({ title: "Real Job" })])
    );

    expect(result.cards.map((c) => c.title)).toEqual(["Real Job"]);
  });

  test("an ad counts in neither cards nor matched", () => {
    const result = readDribbbleCards(dribbbleResultsHtml([adCard("job-list-item--featured")]));

    expect(result.cards).toEqual([]);
    expect(result.matched).toBe(0);
  });
});

describe("matched counts every non-ad li.job-list-item, whether or not it yielded a card", () => {
  test("a broken card still adds to matched even though it adds nothing to cards", () => {
    const good = dribbbleCard({ title: "Good Card" });
    const brokenHref = dribbbleCard({ href: "" });

    const result = readDribbbleCards(dribbbleResultsHtml([good, brokenHref]));

    expect(result.cards).toHaveLength(1);
    expect(result.matched).toBe(2);
  });

  test("an ad among broken and good cards is left out of the matched total", () => {
    const good = dribbbleCard({ title: "Good Card" });
    const brokenTitle = dribbbleCard({ title: "" });
    const ad = adCard("job-list-item--boosted");

    const result = readDribbbleCards(dribbbleResultsHtml([ad, good, brokenTitle]));

    expect(result.matched).toBe(2);
  });

  test("a mix of broken and whole cards leaves matched larger than cards read", () => {
    const result = readDribbbleCards(
      dribbbleResultsHtml([
        dribbbleCard(),
        dribbbleCard({ href: "" }),
        dribbbleCard({ title: "" }),
        dribbbleCard({ age: "" }),
        adCard("job-list-item--featured"),
      ])
    );

    expect(result.cards).toHaveLength(1);
    expect(result.matched).toBe(4);
  });
});

describe("a card missing its link yields no card but still counts as matched", () => {
  test("cards is empty", () => {
    const result = readDribbbleCards(dribbbleResultsHtml([dribbbleCard({ href: "" })]));

    expect(result.cards).toEqual([]);
  });

  test("matched is one", () => {
    const result = readDribbbleCards(dribbbleResultsHtml([dribbbleCard({ href: "" })]));

    expect(result.matched).toBe(1);
  });
});

describe("a card missing its title yields no card but still counts as matched", () => {
  test("cards is empty", () => {
    const result = readDribbbleCards(dribbbleResultsHtml([dribbbleCard({ title: "" })]));

    expect(result.cards).toEqual([]);
  });

  test("matched is one", () => {
    const result = readDribbbleCards(dribbbleResultsHtml([dribbbleCard({ title: "" })]));

    expect(result.matched).toBe(1);
  });
});

describe("a card missing its posted-on age yields no card but still counts as matched", () => {
  // A job with no date can never be aged, so it is not worth returning.

  test("cards is empty", () => {
    const result = readDribbbleCards(dribbbleResultsHtml([dribbbleCard({ age: "" })]));

    expect(result.cards).toEqual([]);
  });

  test("matched is one", () => {
    const result = readDribbbleCards(dribbbleResultsHtml([dribbbleCard({ age: "" })]));

    expect(result.matched).toBe(1);
  });
});

describe("html holding no cards returns an empty result instead of throwing", () => {
  test("an empty results container yields no cards", () => {
    expect(readDribbbleCards(dribbbleResultsHtml([])).cards).toEqual([]);
  });

  test("an empty results container matches nothing", () => {
    expect(readDribbbleCards(dribbbleResultsHtml([])).matched).toBe(0);
  });

  test("an empty string does not throw", () => {
    expect(() => readDribbbleCards("")).not.toThrow();
  });

  test("an empty string yields no cards", () => {
    expect(readDribbbleCards("").cards).toEqual([]);
  });

  test("an empty string matches nothing", () => {
    expect(readDribbbleCards("").matched).toBe(0);
  });
});

describe("whitespace around the title, age, and href is trimmed", () => {
  test("a padded title, age, and href all come back clean", () => {
    const padded = dribbbleCard({
      title: "  Founding Product Designer (Austin, TX)  ",
      age: "  Posted 15 days ago  ",
      href: "  /jobs/42-Some-Job?source=index  ",
    });

    const result = readDribbbleCards(dribbbleResultsHtml([padded]));

    expect(result.cards[0].title).toBe("Founding Product Designer (Austin, TX)");
    expect(result.cards[0].age).toBe("Posted 15 days ago");
    expect(result.cards[0].url).toBe("https://dribbble.com/jobs/42-Some-Job");
  });
});

describe("the committed fixture", () => {
  // The fixture is refreshed by real runs, so these assert structure rather
  // than a specific count of cards or advertisements.

  test("yields at least one card", () => {
    const result = readDribbbleCards(readFixture("dribbble"));

    expect(result.cards.length).toBeGreaterThan(0);
  });

  test("every card has a title, an age, and a url pointing at a dribbble job", () => {
    const result = readDribbbleCards(readFixture("dribbble"));

    for (const resultCard of result.cards) {
      expect(resultCard.title.length).toBeGreaterThan(0);
      expect(resultCard.age.length).toBeGreaterThan(0);
      expect(resultCard.url.startsWith("https://dribbble.com/jobs/")).toBe(true);
    }
  });

  test("matched is at least as large as the number of cards", () => {
    const result = readDribbbleCards(readFixture("dribbble"));

    expect(result.matched).toBeGreaterThanOrEqual(result.cards.length);
  });

  test("no card's url still carries the source query", () => {
    const result = readDribbbleCards(readFixture("dribbble"));

    for (const resultCard of result.cards) {
      expect(resultCard.url).not.toContain("?source=");
    }
  });

  test("every card's age is readable by parseAgeToDays", () => {
    // Catches Dribbble rewording its date labels before a collector run does.
    const result = readDribbbleCards(readFixture("dribbble"));

    for (const resultCard of result.cards) {
      expect(parseAgeToDays(resultCard.age)).not.toBeNull();
    }
  });
});
