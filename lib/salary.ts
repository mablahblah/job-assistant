// Turns each source's salary shape into one common shape: a low and a high in
// whole currency units, a period word from a fixed set, and a plain-text
// record of what the source published. A caller holding cents divides before
// calling, since cents-versus-dollars is a fact about its own source.
//
// It lives outside the collectors so a parser calls the same one rather than
// growing a second copy.

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
