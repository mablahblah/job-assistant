import type { RawSalary } from "../types/job-list-entry";
import { readSalaryFromText } from "./salary";

// Some job descriptions state a pay range in prose where the source
// publishes no structured pay field. readSalaryFromText reads that range
// out of the text, but it answers using the normalized column names
// (salary_low / salary_high), while raw_salary envelopes use salary_min /
// salary_max. This translates one into the other, or returns null when the
// description states no pay at all.
export function rawSalaryFromText(text: string): RawSalary | null {
  const found = readSalaryFromText(text);

  if (found.salary_low === undefined || found.salary_high === undefined) {
    return null;
  }

  return {
    salary_min: found.salary_low,
    salary_max: found.salary_high,
    salary_period: found.salary_period,
    // salary_unit is deliberately left unset: readSalaryFromText returns
    // whole currency units, and normalizeSalary only divides by 100 when
    // salary_unit is "cents". Setting it here would shrink correct figures
    // by a hundredfold.
  };
}
