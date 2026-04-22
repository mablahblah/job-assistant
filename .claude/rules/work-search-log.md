---
paths: ["lib/work-search-log.ts", "lib/work-search-log.test.ts", "lib/work-search-weeks.ts", "lib/company-enrichment.ts"]
---

# Work Search Log & Company Enrichment — Rules

## Qualifying Statuses
Only three statuses trigger a `WorkSearchEntry`: `"app. sent"`, `"screening"`, `"interview"`. The map is in `lib/work-search-log.ts`. Add new trigger statuses there — not in `actions.ts`.

## Fire-and-Forget Enrichment
`enrichCompany()` must always be called without `await` and with `.catch(console.error)`. It must never block the status change or the `WorkSearchEntry` creation. Errors are logged only.

## Pending State Must Be Synchronous
Before the fire-and-forget call, set `enrichmentStatus: "pending"` with `await`. This is the only way the UI can distinguish "never triggered" from "in-progress" at page load. Do not skip this step.

## Idempotency
`enrichCompany()` is a no-op if `enrichedAt` is already set on the company. Check this before setting `pending` too — don't overwrite a completed enrichment with `pending`.

## Enrichment Flags
Uncertainty is stored as comma-separated strings in `enrichmentFlags` (e.g. `"address_outside_us,name_mismatch,missing_data"`). The `enrichmentUncertain` boolean mirrors whether any flags exist. Both fields must be updated together — never one without the other.

## CSS Tokens (reminder)
Work log UI components follow the same two-tier token rule as the rest of the app. Never use primitive theme tokens (e.g. `--black-100`) or raw hex directly in component styles — always use semantic tokens (e.g. `--color-text`, `--color-surface`).
