// Asks the paid search service one query about an employer and hands back
// what it found. The answers fill in the contact details a Texas Workforce
// Commission filing asks for.
//
// The knowledge panel the old plan hoped to read came back empty on every
// measured live result, so a title and its text are all a result carries
// here. Everything else the service returns is dropped.
import { ApifyClient } from "apify-client";

export interface SearchResult {
  title: string;
  text: string;
}

export interface CompanySearch {
  search(query: string): Promise<SearchResult[]>;
}

// The call is injected rather than made here, the way the resolution browser
// takes its launcher. apify-client sends its requests through axios rather
// than fetch, and every other outside service on this branch is tested by
// stubbing the global fetch — which would silently fail to intercept anything
// this client sends. A tool that made the call itself could not be tested
// without paying for a real search.
export type ActorRunner = (query: string, limitSeconds: number) => Promise<unknown[]>;

// Handed to the service as well as held here, so it stops the run being paid
// for rather than only our waiting on it. The old code started the search and
// never waited at all, which lost results whenever the process exited first.
export const SEARCH_TIME_LIMIT_SECONDS = 60;

// Its own type, so a caller can tell a credential that was never set apart
// from a service that failed. Both leave the employer open to a later search,
// but the run says different things about them.
export class MissingSearchCredentialError extends Error {
  constructor(variableName: string) {
    super(`${variableName} is not set, so no employer search can be made.`);
    this.name = "MissingSearchCredentialError";
  }
}

const SEARCH_ACTOR = "datarava/google-search-results-scraper";

const defaultRunner: ActorRunner = async (query, limitSeconds) => {
  const client = new ApifyClient({ token: process.env["APIFY_API_TOKEN"] });
  const run = await client.actor(SEARCH_ACTOR).call(
    {
      search_term: [query],
      country: "United States",
      language: "English",
      // The actor's own minimum.
      number_of_target_records: 10,
    },
    { timeout: limitSeconds, waitSecs: limitSeconds }
  );
  const dataset = await client.dataset(run.defaultDatasetId).listItems();
  return dataset.items;
};

// The old code cast the response without checking it. Measured against the
// live service every item carried a title and a snippet, but a service that
// changes shape must not put undefined onto a legal filing.
function readField(item: unknown, field: string): string {
  if (typeof item !== "object" || item === null) return "";
  const value = (item as Record<string, unknown>)[field];
  return typeof value === "string" ? value : "";
}

export function createCompanySearch(runActor: ActorRunner = defaultRunner): CompanySearch {
  return {
    async search(query: string): Promise<SearchResult[]> {
      // Read at call time rather than at construction, so a tool built before
      // the environment is loaded still works.
      const token = process.env["APIFY_API_TOKEN"];
      if (token === undefined || token === "") {
        throw new MissingSearchCredentialError("APIFY_API_TOKEN");
      }

      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `The search did not answer within its ${SEARCH_TIME_LIMIT_SECONDS} second limit.`
            )
          );
        }, SEARCH_TIME_LIMIT_SECONDS * 1000);
      });

      let items: unknown[];
      try {
        items = await Promise.race([runActor(query, SEARCH_TIME_LIMIT_SECONDS), timedOut]);
      } finally {
        // Cleared once the race settles, so a finished search leaves no timer
        // holding the process open behind it.
        clearTimeout(timer);
      }

      return items.map((item) => ({
        title: readField(item, "title"),
        text: readField(item, "snippet"),
      }));
    },
  };
}
