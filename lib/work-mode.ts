// Reads where a job is worked from out of a description's own words, for the
// ATS sources that publish no work-mode field. It calls descriptionToText
// itself, so a caller passes the description exactly as its source sent it.
//
// It lives outside the collectors so a parser calls the same one rather than
// growing a second copy.

import { descriptionToText } from "./description-text";

export type WorkMode = "remote" | "hybrid" | "in-person";

// A deliberate hashtag such as "#LI-Remote" or "#Hybrid" beats any phrase
// found elsewhere in the text. A recruiter code such as "#LI-KM3" or "#LI-DNI"
// names no mode and fails to match here, so reading falls through to the
// phrases below.
const HASHTAG = /#(?:LI-)?(remote|hybrid|on-?site)\b/i;

// The words allowed straight after a mode named by "this role is ... MODE".
// "This role is a hybrid mix of program management" matches up through
// "hybrid", and a blend of duties is not a place, so the word that follows is
// what rules it out.
const SAFE_AFTER = String.raw`(?:$|[.,;!?]|\s+(?:and|but|as|or|with|within|however|role|position|job))`;

// A phrase anchored to the role, read only where no hashtag settles it. Words
// like "remote" appear in most descriptions as talk about the company, so a
// mode is read only from wording that speaks about this job.
const PHRASES: RegExp[] = [
  new RegExp(
    String.raw`\bthis (?:role|position|job) (?:is|will be) (?:a |an )?(?:fully |100% |entirely )?(remote|hybrid|on-?site|in-person)${SAFE_AFTER}`,
    "i"
  ),
  new RegExp(
    String.raw`\bthis is an? (?:fully |100% |entirely |five-days-|full time, )?(remote|hybrid|on-?site|in-person) (?:role|position|job)\b`,
    "i"
  ),
  new RegExp(
    String.raw`\b(?:fully|100%|entirely) (remote|hybrid|on-?site|in-person) (?:role|position|job)\b`,
    "i"
  ),
  new RegExp(
    String.raw`\b(remote|hybrid|on-?site|in-person)[- ](?:role|position|schedule|work model|working model)\b`,
    "i"
  ),
  new RegExp(String.raw`\bthis (remote|hybrid|on-?site|in-person) (?:role|position)\b`, "i"),
];

// The database holds only these three words, so every other spelling a source
// publishes — onsite, on-site, On-Site, in-person — is translated onto them.
function normalizeMode(word: string): WorkMode {
  const plain = word.toLowerCase();
  if (plain === "remote") return "remote";
  if (plain === "hybrid") return "hybrid";
  return "in-person";
}

export function readWorkModeFromText(raw: string): WorkMode | undefined {
  const text = descriptionToText(raw);

  const hashtag = HASHTAG.exec(text);
  if (hashtag) return normalizeMode(hashtag[1]);

  for (const phrase of PHRASES) {
    const match = phrase.exec(text);
    if (match) return normalizeMode(match[1]);
  }

  return undefined;
}
