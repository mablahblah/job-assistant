import { describe, expect, test } from "vitest";
import { paginate, PAGE_CEILING, type PageRead, type PaginateOptions, type ResultCard } from "./paginate";

// Every test drives real age strings through the search rather than mocking
// job-age.ts, so "3 days ago" and "sometime recently" behave here exactly as
// they do on a live card.

// Each card gets its own url and title, so order and cap tests compare by
// identity instead of guessing at literal strings.
let nextCardId = 0;
function card(age: string): ResultCard {
  nextCardId += 1;
  return {
    url: `https://example.com/jobs/${nextCardId}`,
    title: `Job ${nextCardId}`,
    age,
    company: `Company ${nextCardId}`,
  };
}

// One page's worth of cards. Every card counts as matched unless a test is
// deliberately exercising a poor yield.
function pageOf(cards: ResultCard[], matched = cards.length): PageRead {
  return { cards, matched };
}

// Fills every required option with an inert default, so a test states only
// what it cares about. threshold and limit are still passed explicitly
// everywhere below, because paginate has no default of its own to fall back on.
function paginateOptions(overrides: Partial<PaginateOptions>): PaginateOptions {
  return {
    search: "product designer",
    readPage: async () => pageOf([]),
    advance: async () => false,
    threshold: 21,
    limit: Infinity,
    ...overrides,
  };
}

interface ScriptedReader {
  readPage: () => Promise<PageRead>;
  calls: () => number;
}

// Hands back the given pages in order and counts the calls. Being asked for
// one more page than it was given is a real bug, so it throws rather than
// quietly answering with an empty page.
function scriptedReader(pages: PageRead[]): ScriptedReader {
  let count = 0;
  return {
    readPage: async () => {
      const page = pages[count];
      count += 1;
      if (!page) {
        throw new Error("test reader was asked for more pages than it was given");
      }
      return page;
    },
    calls: () => count,
  };
}

interface ScriptedAdvance {
  advance: () => Promise<boolean>;
  calls: () => number;
}

// Answers from a script, defaulting to true past the end. Its call counter is
// what proves advance was or was not reached.
function scriptedAdvance(answers: boolean[]): ScriptedAdvance {
  let count = 0;
  return {
    advance: async () => {
      const answer = answers[count] ?? true;
      count += 1;
      return answer;
    },
    calls: () => count,
  };
}

// Returns real pages for a while, then throws. An empty goodPages means the
// very first call throws.
function readerThatFailsAfter(goodPages: PageRead[], failure: unknown): () => Promise<PageRead> {
  let index = 0;
  return async () => {
    if (index < goodPages.length) {
      const page = goodPages[index];
      index += 1;
      return page;
    }
    throw failure;
  };
}

// Keeps the search going for goodCalls calls, then throws.
function advanceThatFails(goodCalls: number, failure: unknown): () => Promise<boolean> {
  let count = 0;
  return async () => {
    count += 1;
    if (count <= goodCalls) return true;
    throw failure;
  };
}

// Pages holding one card each, all well under any threshold used below, for
// tests where the only thing that should end the search is the ceiling.
function pagesOfYoungCards(count: number): PageRead[] {
  return Array.from({ length: count }, () => pageOf([card("1 day ago")]));
}

describe("the page ceiling", () => {
  test("is six, the number the phase settled on", () => {
    expect(PAGE_CEILING).toBe(6);
  });
});

describe("cards younger than the threshold accumulate across pages, in page order", () => {
  test("cards from every page appear in the order the pages were read", async () => {
    const first = card("1 day ago");
    const second = card("2 days ago");
    const third = card("3 days ago");
    const reader = scriptedReader([pageOf([first, second], 2), pageOf([third], 1)]);
    const advance = scriptedAdvance([true, false]);
    const options = paginateOptions({
      readPage: reader.readPage,
      advance: advance.advance,
      threshold: 30,
    });

    const result = await paginate(options);

    expect(result.cards.map((c) => c.url)).toEqual([first.url, second.url, third.url]);
  });
});

describe("a card at or past the threshold stops the search immediately", () => {
  test("the returned cards stop just before the one at the threshold", async () => {
    const before = card("3 days ago");
    const atThreshold = card("10 days ago");
    const after = card("1 day ago");
    const reader = scriptedReader([pageOf([before, atThreshold, after], 3)]);
    const options = paginateOptions({
      readPage: reader.readPage,
      advance: async () => true,
      threshold: 10,
    });

    const result = await paginate(options);

    expect(result.cards.map((c) => c.url)).toEqual([before.url]);
  });

  test("advance is never called again", async () => {
    const reader = scriptedReader([pageOf([card("3 days ago"), card("10 days ago")], 2)]);
    const advance = scriptedAdvance([]);
    const options = paginateOptions({
      readPage: reader.readPage,
      advance: advance.advance,
      threshold: 10,
    });

    await paginate(options);

    expect(advance.calls()).toBe(0);
  });

  test("no further page is read", async () => {
    const reader = scriptedReader([pageOf([card("3 days ago"), card("10 days ago")], 2)]);
    const options = paginateOptions({
      readPage: reader.readPage,
      advance: async () => true,
      threshold: 10,
    });

    await paginate(options);

    expect(reader.calls()).toBe(1);
  });
});

describe("an age string that cannot be read stops the search", () => {
  test("the returned cards stop just before the unreadable one", async () => {
    const before = card("2 days ago");
    const unreadable = card("sometime recently");
    const after = card("1 day ago");
    const reader = scriptedReader([pageOf([before, unreadable, after], 3)]);
    const options = paginateOptions({
      readPage: reader.readPage,
      advance: async () => true,
      threshold: 30,
    });

    const result = await paginate(options);

    expect(result.cards.map((c) => c.url)).toEqual([before.url]);
  });

  test("a warning quotes the unreadable string verbatim and names the search", async () => {
    const reader = scriptedReader([pageOf([card("2 days ago"), card("sometime recently")], 2)]);
    const options = paginateOptions({
      readPage: reader.readPage,
      advance: async () => true,
      threshold: 30,
    });

    const result = await paginate(options);

    expect(
      result.warnings.some((w) => w.includes("sometime recently") && w.includes(options.search))
    ).toBe(true);
  });

  test("advance is never called again", async () => {
    const reader = scriptedReader([pageOf([card("2 days ago"), card("sometime recently")], 2)]);
    const advance = scriptedAdvance([]);
    const options = paginateOptions({
      readPage: reader.readPage,
      advance: advance.advance,
      threshold: 30,
    });

    await paginate(options);

    expect(advance.calls()).toBe(0);
  });

  test("no further page is read", async () => {
    const reader = scriptedReader([pageOf([card("2 days ago"), card("sometime recently")], 2)]);
    const options = paginateOptions({
      readPage: reader.readPage,
      advance: async () => true,
      threshold: 30,
    });

    await paginate(options);

    expect(reader.calls()).toBe(1);
  });
});

describe("the search stops after PAGE_CEILING pages even when nothing is old enough to end it", () => {
  // Every test hands over more pages than the ceiling allows, so an
  // off-by-one surfaces as a wrong call count rather than the reader throwing.

  test("no more than PAGE_CEILING pages are ever read", async () => {
    const reader = scriptedReader(pagesOfYoungCards(PAGE_CEILING + 2));
    const options = paginateOptions({
      readPage: reader.readPage,
      advance: async () => true,
      threshold: 30,
    });

    await paginate(options);

    expect(reader.calls()).toBe(PAGE_CEILING);
  });

  test("reaching the ceiling records a warning naming the search", async () => {
    const reader = scriptedReader(pagesOfYoungCards(PAGE_CEILING + 2));
    const options = paginateOptions({
      readPage: reader.readPage,
      advance: async () => true,
      threshold: 30,
    });

    const result = await paginate(options);

    expect(result.warnings.some((w) => w.includes(options.search))).toBe(true);
  });

  test("the last allowed page is read but never advanced past", async () => {
    // Advancing on the final turn would load a page nothing ever reads.
    const reader = scriptedReader(pagesOfYoungCards(PAGE_CEILING + 2));
    const advance = scriptedAdvance([]);
    const options = paginateOptions({
      readPage: reader.readPage,
      advance: advance.advance,
      threshold: 30,
    });

    await paginate(options);

    expect(advance.calls()).toBe(PAGE_CEILING - 1);
  });

  test("every card read before the ceiling is still returned", async () => {
    const reader = scriptedReader(pagesOfYoungCards(PAGE_CEILING + 2));
    const options = paginateOptions({
      readPage: reader.readPage,
      advance: async () => true,
      threshold: 30,
    });

    const result = await paginate(options);

    expect(result.cards.length).toBe(PAGE_CEILING);
  });
});

describe("stopping for a date reason before the ceiling records no ceiling warning", () => {
  test("no warning appears when only two of the six allowed pages were needed", async () => {
    const reader = scriptedReader([pageOf([card("1 day ago")], 1), pageOf([card("40 days ago")], 1)]);
    const options = paginateOptions({
      readPage: reader.readPage,
      advance: async () => true,
      threshold: 30,
    });

    const result = await paginate(options);

    expect(result.warnings).toEqual([]);
  });
});

describe("a search whose reads produce no cards at all records a warning", () => {
  test("the warning names the search", async () => {
    const reader = scriptedReader([pageOf([], 0)]);
    const options = paginateOptions({
      readPage: reader.readPage,
      advance: async () => false,
      threshold: 30,
    });

    const result = await paginate(options);

    expect(result.warnings.some((w) => w.includes(options.search))).toBe(true);
  });

  test("no cards are returned", async () => {
    const reader = scriptedReader([pageOf([], 0)]);
    const options = paginateOptions({
      readPage: reader.readPage,
      advance: async () => false,
      threshold: 30,
    });

    const result = await paginate(options);

    expect(result.cards).toEqual([]);
  });
});

describe("a poor extraction yield records a warning with the proportion", () => {
  test("fewer than half of the matched elements yielding a card warns with both numbers", async () => {
    const cards = [card("1 day ago"), card("2 days ago")];
    const reader = scriptedReader([pageOf(cards, 7)]);
    const options = paginateOptions({
      readPage: reader.readPage,
      advance: async () => false,
      threshold: 30,
    });

    const result = await paginate(options);

    // Two cards out of seven matched elements: both numbers must appear.
    expect(
      result.warnings.some((w) => w.includes(options.search) && w.includes("2") && w.includes("7"))
    ).toBe(true);
  });

  test("exactly half yielding a card does not warn", async () => {
    const cards = [card("1 day ago"), card("2 days ago"), card("3 days ago")];
    const reader = scriptedReader([pageOf(cards, 6)]);
    const options = paginateOptions({
      readPage: reader.readPage,
      advance: async () => false,
      threshold: 30,
    });

    const result = await paginate(options);

    expect(result.warnings).toEqual([]);
  });

  test("two pages that each fall short of half still add exactly one warning", async () => {
    const reader = scriptedReader([
      pageOf([card("1 day ago")], 4),
      pageOf([card("2 days ago")], 4),
    ]);
    const advance = scriptedAdvance([true, false]);
    const options = paginateOptions({
      readPage: reader.readPage,
      advance: advance.advance,
      threshold: 30,
    });

    const result = await paginate(options);

    expect(result.warnings).toHaveLength(1);
  });

  test("the check runs once over the whole search's totals, not once per page", async () => {
    // Page two looks bad alone at one card out of three matched. Added to
    // page one's perfect page the search-wide total lands on exactly half,
    // which is the boundary that does not warn. A per-page check would warn.
    const reader = scriptedReader([pageOf([card("1 day ago")], 1), pageOf([card("2 days ago")], 3)]);
    const advance = scriptedAdvance([true, false]);
    const options = paginateOptions({
      readPage: reader.readPage,
      advance: advance.advance,
      threshold: 30,
    });

    const result = await paginate(options);

    expect(result.warnings).toEqual([]);
  });

  test("cards rejected for being too old still count as the selector working", async () => {
    // The yield check is about the card selector finding a link and a title.
    // Three of these four cards are past the threshold and never returned,
    // but every one of them was read whole, so nothing degraded.
    const reader = scriptedReader([
      pageOf([card("1 day ago"), card("40 days ago"), card("41 days ago"), card("42 days ago")], 4),
    ]);
    const options = paginateOptions({
      readPage: reader.readPage,
      advance: async () => true,
      threshold: 30,
    });

    const result = await paginate(options);

    expect(result.cards).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });
});

describe("the self-check flag says whether the search is trustworthy", () => {
  // It gates refreshing the saved fixture, so a degraded run cannot make its
  // own breakage the new baseline.

  test("a clean search leaves the flag down", async () => {
    const reader = scriptedReader([pageOf([card("1 day ago")], 1)]);
    const options = paginateOptions({
      readPage: reader.readPage,
      advance: async () => false,
      threshold: 30,
    });

    const result = await paginate(options);

    expect(result.selfCheckFailed).toBe(false);
  });

  test("finding no cards at all raises the flag", async () => {
    const reader = scriptedReader([pageOf([], 0)]);
    const options = paginateOptions({
      readPage: reader.readPage,
      advance: async () => false,
      threshold: 30,
    });

    const result = await paginate(options);

    expect(result.selfCheckFailed).toBe(true);
  });

  test("a poor yield raises the flag", async () => {
    const reader = scriptedReader([pageOf([card("1 day ago")], 7)]);
    const options = paginateOptions({
      readPage: reader.readPage,
      advance: async () => false,
      threshold: 30,
    });

    const result = await paginate(options);

    expect(result.selfCheckFailed).toBe(true);
  });

  test("stopping at the page ceiling is not a self-check failure", async () => {
    const reader = scriptedReader(pagesOfYoungCards(PAGE_CEILING + 2));
    const options = paginateOptions({
      readPage: reader.readPage,
      advance: async () => true,
      threshold: 30,
    });

    const result = await paginate(options);

    expect(result.warnings).not.toEqual([]);
    expect(result.selfCheckFailed).toBe(false);
  });

  test("an unreadable age is not a self-check failure", async () => {
    const reader = scriptedReader([pageOf([card("1 day ago"), card("sometime recently")], 2)]);
    const options = paginateOptions({
      readPage: reader.readPage,
      advance: async () => true,
      threshold: 30,
    });

    const result = await paginate(options);

    expect(result.warnings).not.toEqual([]);
    expect(result.selfCheckFailed).toBe(false);
  });

  test("a page read that throws is not a self-check failure", async () => {
    const options = paginateOptions({
      readPage: readerThatFailsAfter([pageOf([card("1 day ago")], 1)], new Error("board unreachable")),
      advance: async () => true,
      threshold: 30,
    });

    const result = await paginate(options);

    expect(result.warnings).not.toEqual([]);
    expect(result.selfCheckFailed).toBe(false);
  });
});

describe("advance resolving false ends the search with no warning", () => {
  test("the card already read is still returned", async () => {
    const only = card("1 day ago");
    const reader = scriptedReader([pageOf([only], 1)]);
    const options = paginateOptions({
      readPage: reader.readPage,
      advance: async () => false,
      threshold: 30,
    });

    const result = await paginate(options);

    expect(result.cards.map((c) => c.url)).toEqual([only.url]);
  });

  test("no warning is recorded", async () => {
    const reader = scriptedReader([pageOf([card("1 day ago")], 1)]);
    const options = paginateOptions({
      readPage: reader.readPage,
      advance: async () => false,
      threshold: 30,
    });

    const result = await paginate(options);

    expect(result.warnings).toEqual([]);
  });

  test("readPage is not called for a further page", async () => {
    const reader = scriptedReader([pageOf([card("1 day ago")], 1)]);
    const options = paginateOptions({
      readPage: reader.readPage,
      advance: async () => false,
      threshold: 30,
    });

    await paginate(options);

    expect(reader.calls()).toBe(1);
  });
});

describe("limit caps the returned cards", () => {
  test("reaching the limit mid-page returns only up to the limit", async () => {
    const first = card("1 day ago");
    const second = card("2 days ago");
    const reader = scriptedReader([pageOf([first, second], 2)]);
    const options = paginateOptions({
      readPage: reader.readPage,
      advance: async () => true,
      threshold: 30,
      limit: 1,
    });

    const result = await paginate(options);

    expect(result.cards.map((c) => c.url)).toEqual([first.url]);
  });

  test("advance is not called once the limit is reached", async () => {
    const reader = scriptedReader([pageOf([card("1 day ago"), card("2 days ago")], 2)]);
    const advance = scriptedAdvance([]);
    const options = paginateOptions({
      readPage: reader.readPage,
      advance: advance.advance,
      threshold: 30,
      limit: 1,
    });

    await paginate(options);

    expect(advance.calls()).toBe(0);
  });

  test("the limit caps cards across a page boundary", async () => {
    const first = card("1 day ago");
    const second = card("2 days ago");
    const third = card("3 days ago");
    const fourth = card("4 days ago");
    const reader = scriptedReader([pageOf([first, second], 2), pageOf([third, fourth], 2)]);
    const advance = scriptedAdvance([true]);
    const options = paginateOptions({
      readPage: reader.readPage,
      advance: advance.advance,
      threshold: 30,
      limit: 3,
    });

    const result = await paginate(options);

    expect(result.cards.map((c) => c.url)).toEqual([first.url, second.url, third.url]);
  });

  test("a limit of Infinity caps nothing", async () => {
    const pages = Array.from({ length: 3 }, () => pageOf([card("1 day ago"), card("1 day ago")], 2));
    const reader = scriptedReader(pages);
    const advance = scriptedAdvance([true, true, false]);
    const options = paginateOptions({
      readPage: reader.readPage,
      advance: advance.advance,
      threshold: 30,
      limit: Infinity,
    });

    const result = await paginate(options);

    expect(result.cards.length).toBe(pages.reduce((sum, p) => sum + p.cards.length, 0));
  });
});

describe("paginate absorbs a failure instead of throwing it", () => {
  const boardDown = new Error("board unreachable");
  const connectionDropped = new Error("connection dropped");

  test("readPage throwing on a later page still returns the cards gathered before it", async () => {
    const first = card("1 day ago");
    const options = paginateOptions({
      readPage: readerThatFailsAfter([pageOf([first], 1)], boardDown),
      advance: async () => true,
      threshold: 30,
    });

    const result = await paginate(options);

    expect(result.cards.map((c) => c.url)).toEqual([first.url]);
  });

  test("readPage throwing records a warning naming the search and carrying the message", async () => {
    const options = paginateOptions({
      readPage: readerThatFailsAfter([pageOf([card("1 day ago")], 1)], boardDown),
      advance: async () => true,
      threshold: 30,
    });

    const result = await paginate(options);

    expect(
      result.warnings.some((w) => w.includes(options.search) && w.includes("board unreachable"))
    ).toBe(true);
  });

  test("a failure on the very first read reports only the failure", async () => {
    // No cards came back, but the failure already says why, so a second
    // warning about an empty search would only be noise.
    const options = paginateOptions({
      readPage: readerThatFailsAfter([], boardDown),
      advance: async () => true,
      threshold: 30,
    });

    const result = await paginate(options);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("board unreachable");
  });

  test("readPage throwing does not reject the call", async () => {
    const options = paginateOptions({
      readPage: readerThatFailsAfter([], boardDown),
      advance: async () => true,
      threshold: 30,
    });

    await expect(paginate(options)).resolves.toBeDefined();
  });

  test("advance throwing still returns the cards gathered before it", async () => {
    const first = card("1 day ago");
    const options = paginateOptions({
      readPage: async () => pageOf([first], 1),
      advance: advanceThatFails(0, connectionDropped),
      threshold: 30,
    });

    const result = await paginate(options);

    expect(result.cards.map((c) => c.url)).toEqual([first.url]);
  });

  test("advance throwing records a warning naming the search and carrying the message", async () => {
    const options = paginateOptions({
      readPage: async () => pageOf([card("1 day ago")], 1),
      advance: advanceThatFails(0, connectionDropped),
      threshold: 30,
    });

    const result = await paginate(options);

    expect(
      result.warnings.some((w) => w.includes(options.search) && w.includes("connection dropped"))
    ).toBe(true);
  });

  test("advance throwing does not reject the call", async () => {
    const options = paginateOptions({
      readPage: async () => pageOf([card("1 day ago")], 1),
      advance: advanceThatFails(0, connectionDropped),
      threshold: 30,
    });

    await expect(paginate(options)).resolves.toBeDefined();
  });

  test("a thrown non-Error value still produces a warning naming the search", async () => {
    // Not an Error, the way a rejected browser operation sometimes surfaces.
    const options = paginateOptions({
      readPage: readerThatFailsAfter([], { code: "ECONNRESET" }),
      advance: async () => true,
      threshold: 30,
    });

    const result = await paginate(options);

    expect(result.warnings.some((w) => w.includes(options.search))).toBe(true);
  });

  test("a thrown non-Error value does not produce the literal '[object Object]'", async () => {
    const options = paginateOptions({
      readPage: readerThatFailsAfter([], { code: "ECONNRESET" }),
      advance: async () => true,
      threshold: 30,
    });

    const result = await paginate(options);

    expect(result.warnings.every((w) => !w.includes("[object Object]"))).toBe(true);
  });
});
