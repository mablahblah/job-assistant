// Reshapes a raw job title into {level} {role} - {team}, so the same role
// published by two sources reads the same. Punctuation is a fixed list of
// nine characters; requisition numbers and gender markers go by shape, with
// no list to fit to a corpus. The level, head-noun and word-removal
// vocabularies are supplied by the caller, so nothing here reads settings or
// a database. When no job noun is found anywhere, the tidied string (or the
// untouched raw title, if tidying left nothing) is returned unmatched rather
// than a guess.

import type { TitleLevel } from "../services/settings-service";

export interface TitleVocabularies {
  headNouns: string[];
  levels: TitleLevel[];
  suffixes: string[];
  removalWords: string[];
}

export interface NormalizedTitle {
  title: string;
  level?: string;
  role?: string;
  team?: string;
  matched: boolean;
}

// One tidied segment (the text between commas, standalone dashes or pipes),
// already split into words with structural junk dropped.
interface Segment {
  words: string[];
}

// The vocabularies, reshaped once per call into the lookups the rest of this
// module actually needs: a spelling-to-stored-form map for levels, and
// lowercase sets/lists for everything compared as a plain word.
interface CompiledVocabularies {
  levelStore: Map<string, string>;
  headNouns: Set<string>;
  suffixes: string[];
  removalWords: Set<string>;
}

const DASH_VARIANTS = /[‐-―−]/g;
const CURLY_SINGLE_QUOTES = /[‘’]/g;
const CURLY_DOUBLE_QUOTES = /[“”]/g;
// The full stop is deleted outright. Inside a word it abbreviates rather than
// separates, so spacing it would turn "U.S." into "U S", and deleting it is
// what lets "Sr." tidy to "Sr" for the level list to match.
const DROPPED_PUNCTUATION = /\./g;

// The other eight characters that are content nowhere: the three bracket
// pairs, the semicolon and the colon. Each leaves a space behind it, because
// deleting one glued to a word welds two words into one — "Designer(6 months"
// has to become "Designer 6 months". Nothing else is on either list; a hash,
// an underscore, a middle dot, an ampersand and a slash are all real content.
// The comma and the pipe are absent because they separate segments, cut at in
// the next step rather than taken out in this one.
const SPACED_PUNCTUATION = /[(){}[\];:]/g;

// Segments are cut at a comma, a pipe, or a dash carrying a space on either
// side. A dash glued on both sides, as in "AI-Enabled", is word-internal and
// stays put.
const SEGMENT_SEPARATOR = /\s*,\s*|\s*\|\s*|\s+-\s*|\s*-\s+/;

// Dash and quote variants fold onto one plain form each, punctuation is taken
// out by the two rules above, and the runs of whitespace that leaves collapse
// to one space.
function tidy(raw: string): string {
  return raw
    .replace(DASH_VARIANTS, "-")
    .replace(CURLY_SINGLE_QUOTES, "'")
    .replace(CURLY_DOUBLE_QUOTES, '"')
    .replace(SPACED_PUNCTUATION, " ")
    .replace(DROPPED_PUNCTUATION, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitIntoSegments(cleaned: string): string[] {
  if (cleaned === "") return [""];
  return cleaned.split(SEGMENT_SEPARATOR).map((segment) => segment.trim());
}

// A requisition number: no letters at all, but at least one digit. A token
// mixing letters and digits, such as "3D" or "W2", has a letter and survives.
function isDigitToken(token: string): boolean {
  return !/[a-zA-Z]/.test(token) && /\d/.test(token);
}

// The shape every gender marker takes: single letters joined by slashes, like
// "m/w/d". A slashed token with any multi-letter part — "UX/UI", "TS/SCI" —
// is a real word and survives.
function isGenderMarkerToken(token: string): boolean {
  if (!token.includes("/")) return false;
  const parts = token.split("/");
  return parts.every((part) => part.length === 1 && /[a-zA-Z]/.test(part));
}

// Words for one segment, with structural junk dropped. Nothing here removes
// a roman numeral — there is no rule against it, which is exactly what keeps
// "UX Designer II" apart from "UX Designer III".
function extractWords(text: string): string[] {
  return text
    .split(/\s+/)
    .filter((token) => token.length > 0 && !isDigitToken(token) && !isGenderMarkerToken(token));
}

function buildLevelStore(levels: TitleLevel[]): Map<string, string> {
  const store = new Map<string, string>();
  for (const level of levels) {
    for (const spelling of level.match) {
      store.set(spelling.toLowerCase(), level.store);
    }
  }
  return store;
}

function compileVocabularies(vocabularies: TitleVocabularies): CompiledVocabularies {
  return {
    levelStore: buildLevelStore(vocabularies.levels),
    headNouns: new Set(vocabularies.headNouns.map((word) => word.toLowerCase())),
    // The leading dash in "-er" is dropped once here, so endsWith can compare
    // it directly against a lowercased word.
    suffixes: vocabularies.suffixes.map((suffix) => suffix.replace(/^-/, "").toLowerCase()),
    removalWords: new Set(vocabularies.removalWords.map((word) => word.toLowerCase())),
  };
}

function isLevelWord(vocab: CompiledVocabularies, word: string): boolean {
  return vocab.levelStore.has(word.toLowerCase());
}

function isHeadNoun(vocab: CompiledVocabularies, word: string): boolean {
  return vocab.headNouns.has(word.toLowerCase());
}

function hasClosedNoun(vocab: CompiledVocabularies, words: string[]): boolean {
  return words.some((word) => isHeadNoun(vocab, word));
}

// A suffix match must be the last word of the segment, and a level word is
// never eligible — otherwise "Senior" and "Junior" would pass as head nouns
// for ending in "-or".
function hasSuffixNoun(vocab: CompiledVocabularies, words: string[]): boolean {
  if (words.length === 0) return false;
  const last = words[words.length - 1];
  if (isLevelWord(vocab, last)) return false;
  const lower = last.toLowerCase();
  return vocab.suffixes.some((suffix) => lower.endsWith(suffix));
}

function hasJobNoun(vocab: CompiledVocabularies, words: string[]): boolean {
  return hasClosedNoun(vocab, words) || hasSuffixNoun(vocab, words);
}

// The longest run of consecutive words, starting at `index`, that spells one
// entry in the level list. Lengths are tried from most words down to one, so
// "mid level" is taken whole rather than leaving "level" stranded behind the
// "mid" that starts it. Where a spelling sits in the vocabulary never
// matters, only how much of the title it accounts for — the list is edited on
// a settings screen, where nobody should have to think about ordering.
function longestLevelMatch(
  vocab: CompiledVocabularies,
  words: string[],
  index: number
): { store: string; length: number } | null {
  for (let length = words.length - index; length >= 1; length--) {
    const phrase = words
      .slice(index, index + length)
      .join(" ")
      .toLowerCase();
    const store = vocab.levelStore.get(phrase);
    if (store !== undefined) return { store, length };
  }
  return null;
}

function isPurelyLevelWords(vocab: CompiledVocabularies, words: string[]): boolean {
  if (words.length === 0) return false;
  let i = 0;
  while (i < words.length) {
    const match = longestLevelMatch(vocab, words, i);
    if (!match) return false;
    i += match.length;
  }
  return true;
}

// The run's stored form, one matched chunk at a time. "Senior" and "Staff"
// each spell their own level and join as "Sr. Staff", while "Mid" and "Level"
// together spell the single entry "mid level" and contribute its one stored
// form. A word spelling no level passes through as it came.
function storedLevelPhrase(vocab: CompiledVocabularies, words: string[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < words.length) {
    const match = longestLevelMatch(vocab, words, i);
    if (match) {
      parts.push(match.store);
      i += match.length;
    } else {
      parts.push(words[i]);
      i++;
    }
  }
  return parts.join(" ");
}

// The role segment is the last one holding a job noun. A closed-list match
// anywhere in a segment wins over a suffix match anywhere else, and a segment
// that is nothing but level words is skipped where any other segment can
// serve instead — but not where it is the only one holding a job noun at
// all, which is why the exclusion is lifted on a second pass.
function selectRoleIndex(vocab: CompiledVocabularies, segments: Segment[]): number {
  const matchers = [
    (words: string[]) => hasClosedNoun(vocab, words),
    (words: string[]) => hasSuffixNoun(vocab, words),
  ];
  for (const excludePureLevel of [true, false]) {
    for (const matches of matchers) {
      for (let i = segments.length - 1; i >= 0; i--) {
        const { words } = segments[i];
        if (words.length === 0) continue;
        if (excludePureLevel && isPurelyLevelWords(vocab, words)) continue;
        if (matches(words)) return i;
      }
    }
  }
  return -1;
}

// The first contiguous run of level words in a segment, wherever it sits. A
// second run later in the same segment is left alone — the word there is the
// job itself rather than its seniority, as in the "Director" of "Senior
// Technical Director". The run steps over a two-word entry in one page, so
// "entry level" is taken whole rather than leaving "level" behind.
function findLevelRun(
  vocab: CompiledVocabularies,
  words: string[]
): { start: number; end: number } | null {
  let i = 0;
  while (i < words.length) {
    const match = longestLevelMatch(vocab, words, i);
    if (match) {
      const start = i;
      i += match.length;
      let next = longestLevelMatch(vocab, words, i);
      while (next) {
        i += next.length;
        next = longestLevelMatch(vocab, words, i);
      }
      return { start, end: i };
    }
    i++;
  }
  return null;
}

export function normalizeTitle(
  rawTitle: string,
  vocabularies: TitleVocabularies
): NormalizedTitle {
  const vocab = compileVocabularies(vocabularies);

  const cleaned = tidy(rawTitle);
  const segments: Segment[] = splitIntoSegments(cleaned).map((text) => ({
    words: extractWords(text),
  }));

  // The tidied string, used only as the fallback when no job noun turns up.
  const nonEmptySegments = segments.filter((segment) => segment.words.length > 0);
  const tidiedDisplay = nonEmptySegments.map((segment) => segment.words.join(" ")).join(", ");

  const roleIndex = selectRoleIndex(vocab, segments);
  if (roleIndex === -1) {
    // Tidying left nothing at all (every token was structural junk): the
    // untouched raw title is what gets stored, not an empty string.
    return { title: tidiedDisplay || rawTitle, matched: false };
  }

  const roleSegment = segments[roleIndex];
  let level: string | undefined;
  let roleWords = roleSegment.words;

  // Take the level run out of the role segment, but only where a job noun
  // survives without it — "Design Director" keeps "Director" for exactly
  // this reason.
  const run = findLevelRun(vocab, roleSegment.words);
  if (run) {
    const remainder = [
      ...roleSegment.words.slice(0, run.start),
      ...roleSegment.words.slice(run.end),
    ];
    if (hasJobNoun(vocab, remainder)) {
      level = storedLevelPhrase(vocab, roleSegment.words.slice(run.start, run.end));
      roleWords = remainder;
    }
  }

  // A segment elsewhere that is nothing but level words is the level,
  // whenever the role segment did not already supply one.
  let consumedIndex = -1;
  if (level === undefined) {
    for (let i = 0; i < segments.length; i++) {
      if (i === roleIndex || segments[i].words.length === 0) continue;
      if (isPurelyLevelWords(vocab, segments[i].words)) {
        level = storedLevelPhrase(vocab, segments[i].words);
        consumedIndex = i;
        break;
      }
    }
  }

  // Every other segment is team. A removal word comes out here — and only
  // here — and a segment left with nothing produces no team item.
  const teamItems: string[] = [];
  segments.forEach((segment, i) => {
    if (i === roleIndex || i === consumedIndex || segment.words.length === 0) return;
    const kept = segment.words.filter((word) => !vocab.removalWords.has(word.toLowerCase()));
    if (kept.length > 0) teamItems.push(kept.join(" "));
  });
  teamItems.sort((a, b) => a.localeCompare(b));
  const team = teamItems.length > 0 ? teamItems.join(", ") : undefined;

  const role = roleWords.join(" ");
  let title = level ? `${level} ${role}` : role;
  if (team) title += ` - ${team}`;

  return { title, level, role, team, matched: true };
}
