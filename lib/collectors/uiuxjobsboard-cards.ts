// Reads UI/UX Jobs Board job cards out of the html of their results
// container. The live collector hands this the container it just fetched; an
// offline test hands it a fixture saved from a real run. Either way the
// selectors live in exactly one place.

import { parseHTML } from "linkedom";
import type { PageRead, ResultCard } from "./paginate";

// The element holding the whole result list. The collector pulls this one
// element's markup, both to read it and to save it as the fixture.
export const UIUX_RESULTS_CONTAINER = "div.max-w-225.flex.flex-col.mx-auto";

// Every card, real or paid, is one of these inside the results container.
const CARD_SELECTOR = "div.border.shadow-xs.rounded-xl";

const UIUX_ORIGIN = "https://uiuxjobsboard.com";

// Derived from what parseHTML actually returns, since the DOM types this
// project omits are not available to name directly.
type LinkedomDocument = ReturnType<typeof parseHTML>["document"];
type CardElement = ReturnType<LinkedomDocument["querySelectorAll"]>[number];

// Named the same way as CardElement, since what querySelector returns is not
// a type this project can name directly either.
type QueriedElement = ReturnType<CardElement["querySelector"]>;

// Every read is funnelled through here to end on a trimmed string, so a
// missing element reads the same as one whose text is blank.
function trimmedText(value: string | null | undefined): string {
  return (value ?? "").trim();
}

// The employer is the holder's first text node. The site's "is hiring" label
// sits in a child element right after it, so reading firstChild rather than
// textContent leaves the label out without needing to know its wording.
function firstChildText(element: QueriedElement): string {
  return trimmedText(element?.firstChild?.nodeValue);
}

// A paid card shares the same markup as a real one, but puts a "Featured"
// badge where the age goes. That badge is the only thing marking it as paid
// rather than posted, and without an age it can never be aged.
function isAdvertisement(element: CardElement): boolean {
  return trimmedText(element.querySelector("div.text-sm")?.textContent).includes("Featured");
}

// The site writes hrefs relative to its own domain, so a relative one is
// prefixed rather than resolved against the page it came from. A query
// string says how the job was found rather than which job it is, so it is
// stripped and one job reached twice keeps one url.
function absoluteUrl(href: string): string {
  const withOrigin = href.startsWith("http") ? href : `${UIUX_ORIGIN}${href}`;
  return withOrigin.split("?")[0];
}

// A job with no link, no title, or no age is not usable, whatever else the
// card carries. The title comes from span.text-2xl rather than the h3 that
// wraps it, because the h3's text runs the company, the words "is hiring",
// and the title together as one string. A missing employer does not return
// null here: null is how the caller spots a drifted selector, and a card that
// simply names no employer is not that, so it is kept with company empty and
// dropped later.
function cardFromElement(element: CardElement): ResultCard | null {
  const href = trimmedText(element.querySelector('a[href*="/job/"]')?.getAttribute("href"));
  const title = trimmedText(element.querySelector("span.text-2xl")?.textContent);
  const age = trimmedText(element.querySelector("div.text-sm")?.textContent);
  const company = firstChildText(element.querySelector("h3 span.text-xl > span"));

  if (href === "" || title === "" || age === "") return null;

  return { url: absoluteUrl(href), title, age, company };
}

export function readUiuxCards(html: string): PageRead {
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
