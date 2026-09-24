// Each parser maps its source's own published fields, then needs to fill
// two gaps out of the job description's own prose: work mode and pay range.
// This util is that shared fallback step, written once so the parsers
// cannot drift apart on how it is applied.
//
// The rule: a field the employer actually published always wins. The
// description is only consulted where the published field came back empty,
// because when the two disagree the published figure is the employer's own
// and the prose might be describing a signing bonus or a different tier.

import type { MappedJobFields } from "../types/job-list-entry";
import { rawSalaryFromText } from "./raw-salary-from-text";
import { readWorkModeFromText } from "./work-mode";

export function withFieldsFromDescription(
  fields: MappedJobFields,
  description: string | undefined
): MappedJobFields {
  // No description means no prose to read — hand back an untouched copy so
  // the caller never gets the original object back by reference.
  if (!description) {
    return { ...fields };
  }

  // Only read the mode out of the text when the source published none.
  const modeIsEmpty = !fields.raw_mode_list || fields.raw_mode_list.length === 0;
  const modeFromText = modeIsEmpty ? readWorkModeFromText(description) : undefined;

  // Only read a salary out of the text when the source published none.
  const salaryIsAbsent = fields.raw_salary === undefined || fields.raw_salary === null;
  const salaryFromText = salaryIsAbsent ? rawSalaryFromText(description) : undefined;

  return {
    ...fields,
    // Conditional spreads so an absent result leaves the key out entirely,
    // rather than adding it back with an undefined value.
    ...(modeFromText ? { raw_mode_list: [modeFromText] } : {}),
    ...(salaryFromText ? { raw_salary: salaryFromText } : {}),
  };
}
