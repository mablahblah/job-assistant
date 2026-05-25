// User's anchor location and search radius for geo-based classification.
// Follows the same pattern as lib/collectors/collector-config.ts.
export const LOCATION_CONFIG = {
  // Center of 78701 (Austin, TX)
  anchorLat: 30.2711,
  anchorLon: -97.7437,
  radiusMiles: 30,
} as const;
