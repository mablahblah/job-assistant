import type { RawSalary } from "../types/job-list-entry";
import type { NormalizedSalary } from "./salary";
import { readSalaryFromText, readSalaryFromPayText } from "./salary";

// Reads pay ranges from job descriptions or source pay fields and
// translates them into RawSalary envelopes, converting the normalized
// salary_low/salary_high to salary_min/salary_max, or returns null if no
// range is found.

function rawSalaryFromNormalizedSalary(normalized: NormalizedSalary): RawSalary | null {
  if (normalized.salary_low === undefined || normalized.salary_high === undefined) {
    return null;
  }

  return {
    salary_min: normalized.salary_low,
    salary_max: normalized.salary_high,
    salary_period: normalized.salary_period,
    // salary_unit is deliberately left unset: readSalaryFromText and
    // readSalaryFromPayText return whole currency units, and normalizeSalary
    // only divides by 100 when salary_unit is "cents". Setting it here would
    // shrink correct figures by a hundredfold.
  };
}

// Some job descriptions state a pay range in prose where the source
// publishes no structured pay field. readSalaryFromText reads that range
// out of the text, but it answers using the normalized column names
// (salary_low / salary_high), while raw_salary envelopes use salary_min /
// salary_max. This function translates one into the other, or returns null
// when the description states no pay at all.
export function rawSalaryFromText(text: string): RawSalary | null {
  const found = readSalaryFromText(text);
  return rawSalaryFromNormalizedSalary(found);
}

export function rawSalaryFromPayText(text: string): RawSalary | null {
  const found = readSalaryFromPayText(text);
  return rawSalaryFromNormalizedSalary(found);
}
