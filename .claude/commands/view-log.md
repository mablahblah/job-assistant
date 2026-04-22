# View Work Search Log

Show the TWC work search activity log.

## Instructions

1. First, auto-enrich any companies missing data:
   ```bash
   npx tsx scripts/cli.ts enrich-log
   ```
   If the result shows `enriched > 0`, tell the user enrichment is running in the background for those companies.

2. Run:
   ```bash
   npx tsx scripts/cli.ts log
   ```

3. Parse the JSON array. Each entry has: `id`, `date`, `activity`, `result`, `jobTitle`, `company`, `address`, `phone`, `website`, `enrichmentStatus`, `enrichmentUncertain`.

4. Present as a formatted log:

   **Work Search Log** (X entries)

   | Date | Activity | Company | Job Title | Result | Address | Phone | Website |
   |---|---|---|---|---|---|---|---|

5. Flag entries where `enrichmentUncertain` is true with ⚠️.

6. Flag entries where `enrichmentStatus` is "pending" or "failed" — note that enrichment data may be incomplete.
