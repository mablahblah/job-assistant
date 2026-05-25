---
paths: ["lib/work-search-log.ts", "lib/work-search-log.test.ts", "lib/work-search-weeks.ts", "lib/company-enrichment.ts"]
---

# Work Search Log & Company Enrichment — Rules

## Qualifying Statuses
Only three statuses trigger a `WorkSearchEntry`: `"app. sent"`, `"screening"`, `"interview"`. The map is in `lib/work-search-log.ts`. New trigger statuses are added there, not in `actions.ts`.

## Fire-and-Forget Enrichment
`enrichCompany()` is called without `await` and with `.catch(console.error)`. It does not block the status change or the `WorkSearchEntry` creation. Errors are logged only.

## Pending State Must Be Synchronous
Before the fire-and-forget call, `enrichmentStatus: "pending"` is set with `await`. This is the only way the UI can distinguish "never triggered" from "in-progress" at page load. MUST NOT skip this step.

## Idempotency
`enrichCompany()` is a no-op if `enrichedAt` is already set on the company. This is checked before setting `pending` — MUST NOT overwrite a completed enrichment with `pending`.

## Enrichment Flags
Uncertainty is stored as comma-separated strings in `enrichmentFlags` (e.g. `"address_outside_us,name_mismatch,missing_data"`). The `enrichmentUncertain` boolean mirrors whether any flags exist. Both fields are always updated together — MUST NOT update one without the other.

## CSS Tokens
Work log UI components use semantic tokens (e.g. `--color-text`, `--color-surface`). Primitive theme tokens (e.g. `--black-100`) and raw hex are not used directly in component styles.
