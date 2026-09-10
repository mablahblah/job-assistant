// The Dribbble job collector. It runs every search term twice — once
// anchored to the user's location, once anywhere — reads the result cards
// off each search, and turns each into a job list entry ready for resolution
// and parsing. Dribbble sends a finished page, so a request and a parse do
// everything a browser would without starting one.
import type { JobListEntry } from "../job-list-entry";
import { ageToDate } from "../job-age";
import { DRIBBBLE_RESULTS_CONTAINER, readDribbbleCards } from "./dribbble-cards";
import { fetchContainer } from "./fetch-page";
import { pickFixture, writeFixture, type FixtureCandidate } from "./fixture";
import { noCardsWarnings, paginate, type PaginateResult, type ResultCard } from "./paginate";
import type { Collector, CollectorResult } from "./types";

const NAME = "dribbble";

const JOBS_URL = "https://dribbble.com/jobs";

// One search this collector runs: a label naming it in every warning, and
// the url that search navigates to.
interface Search {
  label: string;
  url: string;
}

// Two searches per term: one anchored to the user's location, one anywhere.
// The label carries the term because that label is what every warning names.
function buildSearches(searchTerms: string[], location: string): Search[] {
  const searches: Search[] = [];

  for (const term of searchTerms) {
    const locationParams = new URLSearchParams({ keyword: term, location });
    searches.push({
      label: `${term} (${location})`,
      url: `${JOBS_URL}?${locationParams.toString()}`,
    });

    const remoteParams = new URLSearchParams({ keyword: term, anywhere: "true" });
    searches.push({
      label: `${term} (remote)`,
      url: `${JOBS_URL}?${remoteParams.toString()}`,
    });
  }

  return searches;
}

// A card only carries what an aggregator link can supply. The card gives the
// employer its own element, so taking it is not parsing; location, work mode,
// and salary still wait for a parser to read the source posting — a job that
// never reaches one leaves the backlog before anything needs them.
function cardToJob(card: ResultCard): JobListEntry {
  // The card states an age rather than a date. The collector reads it either
  // way, because an age past the expiry threshold is what stops pagination,
  // and there is no column that holds the phrase itself.
  const postingDate = ageToDate(card.age);
  return {
    original_url: card.url,
    raw_title: card.title,
    ...(postingDate ? { posting_date: postingDate } : {}),
    ...(card.company ? { raw_company_name: card.company } : {}),
    is_resolved: false,
    is_parsed: false,
    is_classified: false,
  };
}

export const dribbbleCollector: Collector = {
  name: NAME,

  async collect({ settings, limit }): Promise<CollectorResult> {
    // Read once, before any searching. Reading the threshold inside the loop
    // below would let one run apply a different cutoff to each search.
    const searchTerms = await settings.getSearchTerms();
    const location = await settings.getLocation();
    const threshold = await settings.getExpiryThreshold();

    const searches = buildSearches(searchTerms, location);

    const jobs: JobListEntry[] = [];
    const warnings: string[] = [];
    // Every search's result, kept so the empty ones can be judged together
    // once they have all run. One empty search is ordinary; all of them
    // empty is the card selector having broken.
    const searchResults: PaginateResult[] = [];
    // The fixture is the strongest container the run saw, not the last one.
    // Keeping the last left a real fixture holding a single card, because
    // the last search to return anything was a one-result search.
    let fixture: FixtureCandidate | null = null;

    for (const search of searches) {
      if (jobs.length >= limit) break;

      // Filled by readPage below. One page per search today, so the last
      // read is the only read; choosing between searches is what pickFixture
      // does after this loop.
      let searchHtml = "";
      let searchCards = 0;

      const searchResult = await paginate({
        search: search.label,
        threshold,
        limit: limit - jobs.length,
        readPage: async () => {
          // A search that matched nothing renders no results list at all, so
          // a missing container is an empty page rather than a failure. The
          // empty read still trips the no-cards self-check, which is the
          // signal that belongs here.
          const html = await fetchContainer(search.url, DRIBBBLE_RESULTS_CONTAINER);
          if (html === null) return { cards: [], matched: 0 };

          const pageRead = readDribbbleCards(html);
          searchHtml = html;
          searchCards = pageRead.cards.length;
          return pageRead;
        },
        // Dribbble serves its whole result set on one page. Measured today,
        // "?page=2" comes back empty and scrolling loads nothing further.
        // The ceiling machinery stays wired up for the day that changes.
        advance: async () => false,
      });

      // A refused or timed-out request reaches here as a warning from
      // paginate, which catches what readPage throws. One dead search is a
      // degraded run rather than a failed collector, so the rest still go on.
      warnings.push(...searchResult.warnings);
      searchResults.push(searchResult);
      jobs.push(...searchResult.cards.map(cardToJob));

      fixture = pickFixture(fixture, {
        html: searchHtml,
        cards: searchCards,
        selfCheckFailed: searchResult.selfCheckFailed,
      });
    }

    warnings.push(...noCardsWarnings(searchResults));

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
