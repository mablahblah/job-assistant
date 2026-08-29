// Reads Dribbble job cards out of the html of their results container. The
// live collector hands this the container it just pulled off the page; an
// offline test hands it a fixture saved from a real run. Either way the
// selectors live in exactly one place.

import { parseHTML } from "linkedom";
import type { PageRead, ResultCard } from "./paginate";

// The element holding the whole result list. The collector pulls this one
// element's outerHTML, both to read it and to save it as the fixture.
export const DRIBBBLE_RESULTS_CONTAINER = "ol.job-board-job-list";

// Every card, real or paid, is one of these inside the results container.
const CARD_SELECTOR = "li.job-list-item";

const DRIBBBLE_ORIGIN = "https://dribbble.com";

// Derived from what parseHTML actually returns, since the DOM types this
// project omits are not available to name directly.
type LinkedomDocument = ReturnType<typeof parseHTML>["document"];
type CardElement = ReturnType<LinkedomDocument["querySelectorAll"]>[number];

// Boosted and featured cards are pinned to the top of every search, carry no
// date, and would otherwise stop the date-based search dead. A plain card's
// class is "job-list-item " with a trailing space; an ad's carries one or
// both modifier classes, so checking for the shared "job-list-item--" prefix
// catches either on its own.
function isAdvertisement(element: CardElement): boolean {
  return element.className.includes("job-list-item--");
}

// Every read is funnelled through here to land on a trimmed string, so a
// missing element reads the same as one whose text is blank.
function trimmedText(value: string | null | undefined): string {
  return (value ?? "").trim();
}

// Dribbble writes hrefs relative to its own site, so a relative one is
// prefixed rather than resolved against the page it came from. The query
// string says how the job was found rather than which job it is, so it is
// stripped and one job reached by two searches keeps one url.
function absoluteUrl(href: string): string {
  const withOrigin = href.startsWith("http") ? href : `${DRIBBBLE_ORIGIN}${href}`;
  return withOrigin.split("?")[0];
}

// A job with no link, no title, or no date is not usable, whatever else the
// card carries. A missing employer is different: returning null is how the
// caller spots a drifted selector, and a card that simply names no employer is
// not that, so it is kept with company empty and dropped later.
function cardFromElement(element: CardElement): ResultCard | null {
  const href = trimmedText(element.querySelector("a.job-link")?.getAttribute("href"));
  const title = trimmedText(element.querySelector("h4.job-title")?.textContent);
  const age = trimmedText(element.querySelector(".posted-on")?.textContent);
  const company = trimmedText(element.querySelector("span.job-board-job-company")?.textContent);

  if (href === "" || title === "" || age === "") return null;

  return { url: absoluteUrl(href), title, age, company };
}

export function readDribbbleCards(html: string): PageRead {
  const { document } = parseHTML(html);
  const cards: ResultCard[] = [];
  let matched = 0;

  for (const element of document.querySelectorAll(CARD_SELECTOR)) {
    // An ad belongs in neither total: it is not a card, and counting it
    // would show the caller's yield self-check a drop that never happened.
    if (isAdvertisement(element)) continue;

    matched++;
    const card = cardFromElement(element);
    if (card) cards.push(card);
  }

  return { cards, matched };
}
