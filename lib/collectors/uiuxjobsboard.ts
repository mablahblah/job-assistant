// The UI/UX Jobs Board collector. The site browses by fixed category rather
// than by free-text search, so the user's search terms are matched against
// the site's category labels instead of being sent as a query. Each matched
// category gets one search. The site sends finished html, so a request and a
// parse do everything a browser would without starting one.
import type { JobListEntry } from "../job-list-entry";
import { ageToDate } from "../job-age";
import { fetchContainer } from "./fetch-page";
import { pickFixture, writeFixture, type FixtureCandidate } from "./fixture";
import { matchCategories, type Category } from "./match-categories";
import { paginate, type ResultCard } from "./paginate";
import type { Collector, CollectorResult } from "./types";
import { UIUX_RESULTS_CONTAINER, readUiuxCards } from "./uiuxjobsboard-cards";

const NAME = "uiuxjobsboard";

const DESIGN_JOBS_URL = "https://uiuxjobsboard.com/design-jobs";

// The site's six fixed categories, each a path segment and the label the
// site shows. Measured today, these are the only categories it publishes.
const CATEGORIES: Category[] = [
  { value: "ui-designer", label: "UI Design" },
  { value: "ux-designer", label: "UX Design" },
  { value: "ui-ux-designer", label: "UI/UX Design" },
  { value: "product-designer", label: "Product Design" },
  { value: "ux-researcher", label: "UX Research" },
  { value: "ux-writer", label: "UX Writing" },
];

function categoryUrl(category: Category): string {
  return `${DESIGN_JOBS_URL}/${category.value}`;
}

// Built in exactly one place, so its wording changes without touching the
// logic that decides when it fires.
function noCategoryMatchWarning(): string {
  return `${NAME}: the search terms matched none of the site's categories`;
}

// A card only carries what an aggregator link can supply. Location, work
// mode, salary, and company all wait for a parser to read the source
// posting — a job that never reaches one leaves the backlog before anything
// needs them.
function cardToJob(card: ResultCard): JobListEntry {
  const postingDate = ageToDate(card.age);
  return {
    original_url: card.url,
    raw_title: card.title,
    ...(postingDate ? { posting_date: postingDate } : {}),
    is_resolved: false,
    is_parsed: false,
    is_classified: false,
  };
}

export const uiuxjobsboardCollector: Collector = {
  name: NAME,

  async collect({ settings, limit }): Promise<CollectorResult> {
    // Read once, before any searching. Reading these inside the loop below
    // would let one run apply a different cutoff to each category. The site
    // has no location on these paths, so location is never read here.
    const searchTerms = await settings.getSearchTerms();
    const threshold = await settings.getExpiryThreshold();

    const categories = matchCategories(searchTerms, CATEGORIES);

    // No match is not a failure — the user is simply not searching for
    // anything this site categorises. There is nothing to visit, so the run
    // stops here rather than writing a fixture nothing produced.
    if (categories.length === 0) {
      return { jobs: [], errors: [], warnings: [noCategoryMatchWarning()] };
    }

    const jobs: JobListEntry[] = [];
    const warnings: string[] = [];
    // The fixture is the strongest container the run saw, not the last one.
    // Keeping the last left a real fixture holding a single card, because
    // the last search to return anything was a one-result search.
    let fixture: FixtureCandidate | null = null;

    for (const category of categories) {
      if (jobs.length >= limit) break;

      // Filled by readPage below. One page per search today, so the last
      // read is the only read; choosing between searches is what pickFixture
      // does after this loop.
      let searchHtml = "";
      let searchCards = 0;

      const searchResult = await paginate({
        search: category.label,
        threshold,
        limit: limit - jobs.length,
        readPage: async () => {
          // A category page with nothing on it renders no list at all, so a
          // missing container is an empty page rather than a failure. The
          // empty read still trips the no-cards self-check, which is the
          // signal that belongs here.
          const html = await fetchContainer(categoryUrl(category), UIUX_RESULTS_CONTAINER);
          if (html === null) return { cards: [], matched: 0 };

          const pageRead = readUiuxCards(html);
          searchHtml = html;
          searchCards = pageRead.cards.length;
          return pageRead;
        },
        // Measured today, a category page serves its whole 100-card result
        // set in one go: scrolling loads nothing further and there is no
        // next-page control. The ceiling machinery stays wired up for the
        // day that changes.
        advance: async () => false,
      });

      // A refused or timed-out request reaches here as a warning from
      // paginate, which catches what readPage throws. One dead search is a
      // degraded run rather than a failed collector, so the rest still go on.
      warnings.push(...searchResult.warnings);
      jobs.push(...searchResult.cards.map(cardToJob));

      fixture = pickFixture(fixture, {
        html: searchHtml,
        cards: searchCards,
        selfCheckFailed: searchResult.selfCheckFailed,
      });
    }

    // Called even when the self-check failed: writeFixture is what decides
    // not to write, and it returns the warning saying so.
    // An empty html here means no search returned a card, and writeFixture
    // is what refuses it and says so.
    warnings.push(
      ...writeFixture(NAME, fixture?.html ?? "", {
        selfCheckFailed: fixture?.selfCheckFailed ?? false,
      })
    );

    // A dead search is a degraded run rather than a failed collector, so
    // nothing here is an error.
    return { jobs, errors: [], warnings };
  },
};
