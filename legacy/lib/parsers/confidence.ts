// Compares parser output against collector data to determine per-field confidence

import type {
  ParsedFields,
  ConfidenceResult,
} from "./types";
import { TRACKED_FIELDS } from "./types";

// Normalize for comparison — lowercase, trim, collapse whitespace
function normalizeForCompare(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}

// Compare parser fields against collector fields, return per-field confidence
// Pass null for collected when no collector data exists (all fields become medium)
export function compareFields(
  parsed: Partial<ParsedFields>,
  collected: Partial<ParsedFields> | null,
): ConfidenceResult[] {
  const results: ConfidenceResult[] = [];

  for (const field of TRACKED_FIELDS) {
    const pVal = parsed[field];
    const cVal = collected?.[field];

    // Skip fields neither source provided
    if (!pVal && !cVal) continue;

    if (pVal && cVal) {
      // Both provided — high if they match, low if they disagree
      const match = normalizeForCompare(pVal) === normalizeForCompare(cVal);
      results.push({
        field,
        confidence: match ? "high" : "low",
        value: pVal, // parser always wins
        parserValue: pVal,
        collectorValue: cVal,
      });
    } else {
      // Only one source had this field
      results.push({
        field,
        confidence: "medium",
        value: (pVal || cVal)!,
        ...(pVal ? { parserValue: pVal } : {}),
        ...(cVal ? { collectorValue: cVal } : {}),
      });
    }
  }

  return results;
}
