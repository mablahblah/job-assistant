// Turns each source's raw_salary envelope into one common shape: a low and a
// high in whole currency units, and a period word from a fixed set. A figure
// sent in cents is divided down to whole units before it is rounded.
//
// It lives outside the collectors so a parser calls the same one rather than
// growing a second copy.

import { descriptionToText } from "./description-text";

export type SalaryPeriod = "year" | "month" | "week" | "day" | "hour";

export interface NormalizedSalary {
  salary_low?: number;
  salary_high?: number;
  salary_period?: SalaryPeriod;
}

const RECOGNISED_PERIODS: Record<string, SalaryPeriod> = {
  year: "year",
  month: "month",
  week: "week",
  day: "day",
  hour: "hour",
};

// raw_salary comes back from the database as JSON, so nothing guarantees its
// shape. This is the only check standing between a malformed envelope and a
// crash.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// A source can send a string, a null, or leave the key out entirely where a
// number belongs. Anything but a real number reads as absent, so a bad shape
// never leaves a NaN sitting in an Int column. Zero is a real figure and is
// kept.
function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// Absent or empty gives year, since Adzuna and Greenhouse both publish annual
// figures without stating a period. A leading count is dropped first, so
// Ashby's "1 YEAR" reads the same as JSearch's "YEAR". A word outside the five
// recognised ones comes back undefined rather than the nearest-looking match,
// so a wrong guess never reaches the database.
function matchPeriod(period: string | undefined): SalaryPeriod | undefined {
  const word = (period ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\d+\s*/, "");
  if (!word) return "year";
  return RECOGNISED_PERIODS[word];
}

export function normalizeSalary(raw: unknown): NormalizedSalary {
  if (!isRecord(raw)) return {};

  // A source publishing minor units marks it with salary_unit: "cents". The
  // figures are divided down before they are rounded, so a fractional cent
  // total such as 14000001 lands on a whole unit rather than leaving a
  // fraction that only fails at save time.
  const divisor = raw.salary_unit === "cents" ? 100 : 1;

  const rawLow = readNumber(raw.salary_min);
  const rawHigh = readNumber(raw.salary_max);
  const low = rawLow === undefined ? undefined : Math.round(rawLow / divisor);
  const high = rawHigh === undefined ? undefined : Math.round(rawHigh / divisor);

  // A period or a currency on its own is not a salary. Without a number there
  // is nothing to report.
  if (low === undefined && high === undefined) return {};

  const result: NormalizedSalary = {};
  if (low !== undefined) result.salary_low = low;
  if (high !== undefined) result.salary_high = high;

  const period = matchPeriod(
    typeof raw.salary_period === "string" ? raw.salary_period : undefined
  );
  if (period !== undefined) result.salary_period = period;

  // salary_currency travels in the envelope but there is no currency column
  // yet, so nothing is done with it here.

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
  };
}
