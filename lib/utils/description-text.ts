// Turns a job description exactly as a collector stored it into plain,
// readable text. Greenhouse sends HTML that has itself been entity-encoded
// once, while Lever and Ashby send plain text with no markup at all. Every
// reader downstream of this works from the same plain string rather than each
// parsing markup on its own.

import { parseHTML } from "linkedom";

// A tag written as "&lt;div&gt;" rather than "<div>" marks a description whose
// markup has itself been entity-encoded once. Decoding it turns the tags back
// into real markup, while something like "&amp;mdash;" is left as the entity
// "&mdash;" — that only becomes a real dash once the markup is parsed.
const ENCODED_TAG = /&lt;\/?[a-z]/i;

function decodeEntitiesOnce(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

// Tags that end a block of text. Reading the text alone runs one block
// straight into the next, so "team</p><p>This role is remote" would arrive as
// "teamThis role is remote" and the sentence would no longer be found. A
// space after each of these keeps the words apart. Inline tags get none, so
// Greenhouse's "<span>$139,200</span><span>—</span>" stays a single figure.
const BLOCK_END =
  /<\/(?:p|div|li|ul|ol|h[1-6]|tr|td|th|table|section|article|header|footer|blockquote|pre)>|<br\s*\/?>|<hr\s*\/?>/gi;

export function descriptionToText(raw: string): string {
  const html = ENCODED_TAG.test(raw) ? decodeEntitiesOnce(raw) : raw;
  const spaced = html.replace(BLOCK_END, "$& ");

  // A description carrying its own literal <body> tag hands linkedom an empty
  // body, so every description is parsed inside a full document rather than
  // as a bare fragment.
  const { document } = parseHTML(`<html><body>${spaced}</body></html>`);
  const text = document.body?.textContent ?? "";

  // Any run of whitespace left over — newlines, tabs, repeated spaces —
  // collapses to a single space.
  return text.replace(/\s+/g, " ").trim();
}
