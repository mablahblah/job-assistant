# Decision Log: Job Search Assistant

> Permanent record of lasting decisions for Job Search Assistant

## Decisions

- **2026-09-06** -- When two sources disagree about a job's details, the source priority list decides which one wins. **Why:** a rule in the code sitting above the list would make reordering the list appear to do nothing. **Rejected:** a rule in the code that overrides the list.
- **2026-09-21** -- A job board whose identity takes more than one value is stored as one text value in the board table, its parts joined by a colon, and only that source's own code splits it apart. **Why:** the table and every reader stay unchanged, so a new source needs no schema change. **Rejected:** changing the board table's schema to hold each part separately.
