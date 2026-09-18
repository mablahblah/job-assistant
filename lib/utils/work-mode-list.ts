// Turns each source's own spelling of where a job is worked into the three
// words the database holds. work-mode.ts also does this translation, but its
// fallback assumes every word is one it already recognises, because it only
// ever sees a word a regex has matched first. A source sends whatever word it
// likes, so this version drops anything it does not recognise instead of
// guessing.

import type { WorkMode } from "./work-mode";

// Every spelling a source is known to send, plus the words the description
// reader can return, plus every spelling the location splitter recognises, so
// the two cannot drift apart. A word not in this table has no match, so a
// lookup naturally drops it rather than guessing at a mode.
const RECOGNISED_MODES: Record<string, WorkMode> = {
  remote: "remote",
  "fully remote": "remote",
  hybrid: "hybrid",
  onsite: "in-person",
  "on-site": "in-person",
  "on site": "in-person",
  "in-office": "in-person",
  inoffice: "in-person",
  "in office": "in-person",
  "in-person": "in-person",
  inperson: "in-person",
  "in person": "in-person",
};

export function normalizeModeList(raw: string[]): WorkMode[] {
  const result: WorkMode[] = [];

  for (const word of raw) {
    const mode: WorkMode | undefined = RECOGNISED_MODES[word.toLowerCase()];

    // Skip unrecognised words, and skip a mode already in the result so a
    // repeated spelling does not add a second entry.
    if (mode && !result.includes(mode)) result.push(mode);
  }

  return result;
}
