# Session status — phase 7, URL Resolution

Phase 7 (URL Resolution) is 9 of 18 tasks done — the whole walk exists offline and `delete_on_save` now admits `blacklisted_url`. Last session closed task 9 plus the hop-budget decision; the tree is clean, 1,817 tests pass, lint exits 0. Next is task 10: the resolution job-list read on the job service and its fake — every job with status `backlog` and `is_resolved` false, carrying `id`, `collector`, `created_at`, and none of the four flags (criteria 1–4).

Is task 10 what you want to work on?
