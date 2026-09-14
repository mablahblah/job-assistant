// Decides whether a point falls inside a place's own outline on the map.
// Containment has to be settled by geometry, never by matching names: a job in
// Austin, Arkansas read as a local job and landed in the backlog, and any place
// called St. Johns would match the user's own neighbourhood. An outline cannot
// make that mistake.

export interface MapShape {
  type: string;
  // Left as unknown because the mapping service's shapes nest to different
  // depths, and the committed JSON the tests read is typed loosely. The
  // function narrows on `type` before touching it.
  coordinates: unknown;
}

type Ring = number[][];

// Ray casting across one ring. Counts crossings of the horizontal line through
// the test point; an odd count means inside.
function insideRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as [number, number];
    const [xj, yj] = ring[j] as [number, number];
    if (yi > y !== yj > y) {
      const crossing = ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (x < crossing) inside = !inside;
    }
  }
  return inside;
}

// Longitude first, then latitude, because that is the order GeoJSON writes.
// A Polygon is one outer ring followed by its holes. A MultiPolygon is a list
// of those. Anything else — a Point, a LineString, a missing outline — is not
// an area, so it can never contain anything and the caller falls back on
// distance.
export function pointInShape(lon: number, lat: number, shape: MapShape | null): boolean {
  if (!shape) return false;
  const polygons: Ring[][] =
    shape.type === "Polygon"
      ? [shape.coordinates as Ring[]]
      : shape.type === "MultiPolygon"
        ? (shape.coordinates as Ring[][])
        : [];
  for (const polygon of polygons) {
    const [outer, ...holes] = polygon;
    if (!outer) continue;
    if (!insideRing(lon, lat, outer)) continue;
    if (holes.some((hole) => insideRing(lon, lat, hole))) continue;
    return true;
  }
  return false;
}
