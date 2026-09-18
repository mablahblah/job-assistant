// A stateful stand-in PlaceService for tests that store and look up geocoded
// places without a database or a real geocoder. Unlike the project's other
// fakes this one must remember what happened between calls, so a place stored
// by one call is then found by the next — it mirrors the real service's
// exact-text matching against the array the caller passed in, which a test can
// also start off already holding places.
import type { PlaceRecord, PlaceService } from "./place-service";
import type { GeocodedPlace } from "../tools/geocoder";

export function fakePlaceService(
  places: PlaceRecord[] = [],
  overrides: Partial<PlaceService> = {}
): PlaceService {
  async function findByText(text: string): Promise<PlaceRecord | null> {
    return places.find((place) => place.lookup_text === text) ?? null;
  }

  async function store(text: string, place: GeocodedPlace | null): Promise<void> {
    // A lookup that found nothing is never stored, so the text stays unknown
    // and is tried again next run.
    if (place === null) return;

    const record: PlaceRecord = { lookup_text: text, ...place };
    const existingIndex = places.findIndex((existing) => existing.lookup_text === text);
    if (existingIndex === -1) {
      places.push(record);
    } else {
      places[existingIndex] = record;
    }
  }

  return { findByText, store, ...overrides };
}
