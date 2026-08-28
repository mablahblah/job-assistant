// Turns each source's salary shape into one common shape: a low and a high in
// whole currency units, a period word from a fixed set, and a plain-text
// record of what the source published. A caller holding cents divides before
// calling, since cents-versus-dollars is a fact about its own source.
//
// It lives outside the collectors so a parser calls the same one rather than
// growing a second copy.

import { descriptionToText } from "./description-text";

export type SalaryPeriod = "year" | "month" | "week" | "day" | "hour";

export interface NormalizedSalary {
  salary_low?: number;
  salary_high?: number;
  salary_period?: SalaryPeriod;
  salary_raw?: string;
}

const RECOGNISED_PERIODS: Record<string, SalaryPeriod> = {
  year: "year",
  month: "month",
  week: "week",
  day: "day",
  hour: "hour",
};

// null and undefined both mean the source said nothing. Zero is a real figure
// and must not be mistaken for absence.
function isPresent(value: number | null | undefined): value is number {
  return value !== null && value !== undefined;
}

// Absent or empty gives year, since Adzuna and Greenhouse both publish annual
// figures without stating a period. A word outside the five recognised ones
// comes back undefined rather than the nearest-looking match, so a wrong guess
// never reaches the database.
function matchPeriod(period: string | null | undefined): SalaryPeriod | undefined {
  const word = (period ?? "").trim().toLowerCase();
  if (!word) return "year";
  return RECOGNISED_PERIODS[word];
}

// A plain readable line recording what the source published. Never JSON, so it
// stays free of braces, brackets and quote marks.
function buildSalaryRaw(
  low: number | undefined,
  high: number | undefined,
  period: string | null | undefined,
  currency: string | null | undefined
): string {
  const parts: string[] = [];

  if (isPresent(low) && isPresent(high)) parts.push(`${low}-${high}`);
  else if (isPresent(low)) parts.push(`${low}`);
  else if (isPresent(high)) parts.push(`${high}`);

  if (currency) parts.push(currency);

  // Kept as the source wrote it, even a word this util does not recognise as a
  // period. Only salary_period loses it; the raw line never does.
  const periodWord = (period ?? "").trim();
  if (periodWord) parts.push(`per ${periodWord.toLowerCase()}`);

  return parts.join(" ");
}

export function normalizeSalary(input: {
  low?: number | null;
  high?: number | null;
  period?: string | null;
  currency?: string | null;
}): NormalizedSalary {
  // Rounded to whole units, because a source such as Adzuna publishes figures
  // like 134044.9 and the columns hold whole numbers. Rounding here is the
  // only place that can keep the promise this util's name makes.
  const low = isPresent(input.low) ? Math.round(input.low) : undefined;
  const high = isPresent(input.high) ? Math.round(input.high) : undefined;

  // A period or a currency on its own is not a salary. Without a number there
  // is nothing to report.
  if (low === undefined && high === undefined) return {};

  const result: NormalizedSalary = {
    salary_raw: buildSalaryRaw(low, high, input.period, input.currency),
  };

  if (low !== undefined) result.salary_low = low;
  if (high !== undefined) result.salary_high = high;

  const period = matchPeriod(input.period);
  if (period !== undefined) result.salary_period = period;

  return result;
}

// Reads a pay range straight out of a job description's own words, for the
// ATS sources that publish salary in prose rather than a field of their own.
// It calls descriptionToText itself, so a caller passes the description
// exactly as its source sent it.

const CURRENCY_SYMBOL = String.raw`[$£€]`;
const CURRENCY_CODE = String.raw`(?:USD|CAD|GBP|EUR)`;
const CURRENCY = String.raw`(?:${CURRENCY_SYMBOL}|${CURRENCY_CODE})`;

// A thousands group may carry a stray space, as in "261, 000", and a figure
// may end in a "k" standing in for a thousand.
const AMOUNT = String.raw`\d+(?:,\s?\d+)*(?:\.\d+)?\s*[kK]?`;

// A currency may lead the low figure, sit between the two, or only trail the
// high one as a bare code. At least one of the three has to be there for a
// match to count as pay, so a bare pair of numbers such as "Zone 2 - 4" is
// never read as a salary.
const RANGE_SOURCE = String.raw`(${CURRENCY})?\s?(${AMOUNT})\s*(?:-|–|—|to)\s*(${CURRENCY})?\s?(${AMOUNT})(?:\s*(${CURRENCY_CODE}))?`;

// A "between" range always names its currency right after the word.
const BETWEEN_SOURCE = String.raw`between\s+(${CURRENCY})\s?(${AMOUNT})(?:\s*[A-Z]{3})?\s+and\s+(${CURRENCY})?\s?(${AMOUNT})`;

const PERIOD_WORD =
  /^[\s,.]*(?:\/\s*|per\s+|an?\s+)?(hour|hourly|hr|year|yearly|yr|annum|annually|month|monthly|mo|week|weekly|day|daily)\b/i;

// Every spelling a description uses, translated onto the five words
// salary_period holds. This is a wider net than RECOGNISED_PERIODS above:
// that map rejects a structured field's unrecognised word outright, while
// prose never states a period the same way twice.
const PERIOD_WORDS: Record<string, SalaryPeriod> = {
  hour: "hour",
  hourly: "hour",
  hr: "hour",
  year: "year",
  yearly: "year",
  yr: "year",
  annum: "year",
  annually: "year",
  month: "month",
  monthly: "month",
  mo: "month",
  week: "week",
  weekly: "week",
  day: "day",
  daily: "day",
};

interface RangeMatch {
  index: number;
  end: number;
  low: string;
  high: string;
}

// A thousands group holds exactly three digits, so "$118,00" is a digit short
// of a real figure. Reading it would file a $118,000 job as $11,800, which is
// worse than filing no salary at all. A dot followed by anything other than
// two digits separates thousands rather than marking cents.
function parseAmount(raw: string): number | null {
  let plain = raw.trim();
  const inThousands = /[kK]$/.test(plain);
  plain = plain.replace(/[kK]$/, "").trim();

  for (const group of plain.matchAll(/,\s*(\d+)/g)) {
    if (group[1].length !== 3) return null;
  }
  plain = plain.replace(/,\s*/g, "");

  const dot = plain.lastIndexOf(".");
  if (dot !== -1 && plain.length - dot - 1 !== 2) plain = plain.replace(/\./g, "");

  const value = Number(plain);
  if (!Number.isFinite(value)) return null;
  return inThousands ? value * 1000 : value;
}

// Finds the first range carrying a currency somewhere in it, skipping past a
// bare pair of numbers rather than reading one as pay.
function firstDashRange(text: string): RangeMatch | null {
  const pattern = new RegExp(RANGE_SOURCE, "gi");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const [whole, leading, low, middle, high, trailing] = match;
    if (leading || middle || trailing) {
      return { index: match.index, end: match.index + whole.length, low, high };
    }
  }
  return null;
}

function firstBetweenRange(text: string): RangeMatch | null {
  const match = new RegExp(BETWEEN_SOURCE, "i").exec(text);
  if (match === null) return null;
  const [whole, , low, , high] = match;
  return { index: match.index, end: match.index + whole.length, low, high };
}

// Stated hourly rates run from about 18 to about 42, and stated yearly ones
// start around 108,000, with nothing in between. A description naming no
// period is read as hourly only where both figures fall under a thousand.
function readPeriod(remainder: string, low: number, high: number): SalaryPeriod {
  const stated = PERIOD_WORD.exec(remainder);
  if (stated) return PERIOD_WORDS[stated[1].toLowerCase()];
  return low < 1000 && high < 1000 ? "hour" : "year";
}

export function readSalaryFromText(text: string): NormalizedSalary {
  const plain = descriptionToText(text);

  // The first range in the description wins, whichever shape it is written
  // in, so both shapes are found and the earlier one kept.
  const dash = firstDashRange(plain);
  const between = firstBetweenRange(plain);
  const range =
    dash && between ? (dash.index <= between.index ? dash : between) : (dash ?? between);
  if (range === null || range === undefined) return {};

  const low = parseAmount(range.low);
  const high = parseAmount(range.high);
  // A figure short of a digit, or a high below the low, is refused outright
  // rather than filed as a partly-wrong salary.
  if (low === null || high === null || high < low) return {};

  return {
    salary_low: low,
    salary_high: high,
    salary_period: readPeriod(plain.slice(range.end), low, high),
    // Holds the source's own commas and currency mark, unlike the raw line
    // normalizeSalary builds out of the numbers.
    salary_raw: plain.slice(range.index, range.end).trim(),
  };
}
