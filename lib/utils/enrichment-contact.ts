// Reads a mailing address, a phone number and a website out of one internet
// search result's text. These feed a Texas Workforce Commission filing, so a
// shape this misses costs the user a blank field on a legal form.

export interface ContactDetails {
  address?: string;
  phone?: string;
  website?: string;
}

// Street words, longest spellings first. The old reader recognized only the
// abbreviated forms, so "760 Market Street" and "1600 Amphitheatre Parkway"
// were both missed while "760 Market St" was found. That gap was measured
// against real search text, and widening it to both spellings was approved.
const STREET_TYPES =
  "Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln|Parkway|Pkwy|Place|Pl|Court|Ct|Circle|Cir|Terrace|Ter|Highway|Hwy|Square|Sq|Plaza|Plz|Trail|Trl|Floor|Fl|Way";

// Tried first: a text saying "Headquarters:" or "Address:" is telling us which
// of its numbers is the address, so that one is trusted over any bare pattern
// found elsewhere in the same text.
const LABELLED_ADDRESS = new RegExp(
  String.raw`(?:headquarters|address)[.:\s]+(\d+\s+[^;\n]{10,60}[A-Z]{2}[\s,]+\d{5})`,
  "i"
);

// Falls back to shape alone where nothing is labelled. Deliberately
// case-sensitive: the two letters are a US state code, and ignoring case
// would let any two letters stand in for one.
const BARE_ADDRESS = new RegExp(
  String.raw`\d+\s+\w+.*?(?:${STREET_TYPES})\b.*\b[A-Z]{2}\s+\d{5}`
);

const PHONE = /\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/;

const WEBSITE = /(?:website|web)[.:]\s*((?:https?:\/\/)?[\w.-]+\.[a-z]{2,})/i;

// A bare domain is given a scheme because the value is shown as a link, and a
// link with no scheme is read as a path on our own site.
function urlFromCaptured(captured: string): string {
  return captured.startsWith("http") ? captured : `https://${captured}`;
}

export function contactFromText(text: string): ContactDetails {
  const details: ContactDetails = {};

  const address = LABELLED_ADDRESS.exec(text)?.[1] ?? BARE_ADDRESS.exec(text)?.[0];
  if (address !== undefined) {
    details.address = address.trim();
  }

  const phone = PHONE.exec(text)?.[0];
  if (phone !== undefined) {
    details.phone = phone;
  }

  const website = WEBSITE.exec(text)?.[1];
  if (website !== undefined) {
    details.website = urlFromCaptured(website);
  }

  return details;
}
