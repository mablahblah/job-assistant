---
paths: ["lib/**/registry.ts"]
---

# Source Registries

A change that adds, removes, or renames a registry entry runs `npm run db:seed` in the same change.

The seed appends every registry name absent from `source_priority_list` to the bottom of that list. A source missing from that list ranks below every source in it, so it loses every field two sources contest.
