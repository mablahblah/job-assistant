// Reads a job posting that is shown only as ordinary page text (no machine-readable
// job data). Pulls the posting's own article out with Readability, and separately
// scans the whole page's text for a few details that sites often show as a label next
// to a value in the page's layout, outside the article itself (a posted date, an
// updated date, a location). Returns null when the page has no real job text at all.

import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { ageToDate } from "./job-age";
import { readWorkModeFromText } from "./work-mode";
import type { MappedJobFields } from "../types/job-list-entry";

// Readability's own default: below this many characters of article text, treat the
// page as not holding a real posting. Measured job pages gave 1,000 characters or more.
const MIN_ARTICLE_TEXT_LENGTH = 500;

// Block-level tags: each one's own text is read as a single line, so a label sitting
// in one element (e.g. a "Posted" line) is never run together with the next element's
// text. This is HTML's usual notion of a block element, not a site-specific list.
const BLOCK_TAGS = [
  "p", "li", "h1", "h2", "h3", "h4", "h5", "h6",
  "div", "header", "footer", "nav", "section", "article",
  "tr", "td", "th", "dt", "dd", "blockquote", "pre",
];
const BLOCK_SELECTOR = BLOCK_TAGS.join(",");

// A label followed by an optional colon, at the very start of a line, in any letter case.
const POSTED_LABEL_PATTERN = /^(posted on|posted|date posted|posting date)\s*:?\s*(.+)$/i;
const UPDATED_LABEL_PATTERN = /^(last updated|updated)\s*:?\s*(.+)$/i;
const LOCATION_LABEL_PATTERN = /^(location)\s*:?\s*(.+)$/i;

// A value counts as an age ("3 days ago", "yesterday") when it ends in "ago" or is one
// of the standalone age words; anything else is tried as a calendar date instead.
const AGE_SUFFIX_PATTERN = /ago\s*$/i;
const AGE_WORD_PATTERN = /^(yesterday|today|just now)$/i;

// The document type linkedom's parseHTML hands back.
type ParsedDocument = ReturnType<typeof parseHTML>["document"];

// Runs Readability over its own parsed copy of the page, since Readability mutates the
// document it reads. Returns the article's HTML, or null when there is no real posting
// text on the page.
function extractDescription(html: string): string | null {
  const { document } = parseHTML(html);
  // linkedom's Document implements the same shape Readability reads (verified against
  // @mozilla/readability 0.6.0); it is a different type only at the TypeScript level,
  // so a single cast here stands in for the DOM Document Readability's types expect.
  const article = new Readability(document as unknown as Document).parse();
  if (!article) return null;

  const articleText = (article.textContent ?? "").trim();
  if (articleText.length < MIN_ARTICLE_TEXT_LENGTH) return null;

  // Readability can report an article with no HTML content; that counts as no job text.
  return article.content ?? null;
}

// Turns the whole page into one line of text per leaf block element (a block element
// that itself contains no other block element), in document order. A container such as
// <article> or <main> is skipped so its children's separate lines are not merged back
// into one long line.
function linesFromDocument(document: ParsedDocument): string[] {
  // Iterated directly rather than through Array.from, which loses linkedom's element type.
  const blocks = document.querySelectorAll(BLOCK_SELECTOR);
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.querySelector(BLOCK_SELECTOR)) continue;
    const text = (block.textContent ?? "").trim();
    if (text) lines.push(text);
  }
  return lines;
}

// Finds the first line matching a label pattern and returns the value after the label,
// or null when no line carries that label.
function firstLabelledValue(lines: string[], pattern: RegExp): string | null {
  for (const line of lines) {
    const match = pattern.exec(line);
    if (match) return match[2] ?? null;
  }
  return null;
}

// Reads a labelled value as either an age counted back from referenceInstant, or a
// calendar date. Returns null when it reads as neither.
function parseLabelledDate(rawValue: string, referenceInstant: Date): Date | null {
  const value = rawValue.trim();
  if (!value) return null;

  const looksLikeAge = AGE_SUFFIX_PATTERN.test(value) || AGE_WORD_PATTERN.test(value);
  if (looksLikeAge) return ageToDate(value, referenceInstant);

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function jobFieldsFromPageText(html: string, referenceInstant: Date): MappedJobFields | null {
  const description = extractDescription(html);
  if (description === null) return null;

  const fields: MappedJobFields = { description };

  // A fresh parse for the whole-page text scan, separate from the one handed to
  // Readability above.
  const { document } = parseHTML(html);
  const lines = linesFromDocument(document);

  const postedRaw = firstLabelledValue(lines, POSTED_LABEL_PATTERN);
  if (postedRaw !== null) {
    const postedDate = parseLabelledDate(postedRaw, referenceInstant);
    if (postedDate) fields.posting_date = postedDate;
  }

  const updatedRaw = firstLabelledValue(lines, UPDATED_LABEL_PATTERN);
  if (updatedRaw !== null) {
    const updatedDate = parseLabelledDate(updatedRaw, referenceInstant);
    if (updatedDate) fields.posting_updated_date = updatedDate;
  }

  const locationRaw = firstLabelledValue(lines, LOCATION_LABEL_PATTERN);
  if (locationRaw !== null && locationRaw.trim()) {
    fields.raw_location_list = [locationRaw.trim()];
  }

  // Work mode wording (e.g. "this is a hybrid role") can appear anywhere on the page,
  // and readWorkModeFromText already knows to read only wording about the role itself.
  const mode = readWorkModeFromText(html);
  if (mode) fields.raw_mode_list = [mode];

  return fields;
}
