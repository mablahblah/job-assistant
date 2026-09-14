// A stand-in for the real mapping service so no test in the suite ever sends
// a real geocoding request — a real run would cost money and be throttled to
// one lookup a second. A test writes a table of place text to answer (or an
// Error to throw for that text) and the fake answers from it, recording every
// text it was asked about, in order, so a test can prove a place was looked
// up once and reused rather than fetched twice.
import type { Geocoder, GeocodedPlace } from "./geocoder";

// A table entry is either the place to answer with, or an Error to throw
// instead, so a test can make the mapping service refuse mid-run.
export type GeocoderAnswer = GeocodedPlace | Error;

export interface FakeGeocoder extends Geocoder {
  lookedUp: string[];
}

export function fakeGeocoder(table: Record<string, GeocoderAnswer> = {}): FakeGeocoder {
  const lookedUp: string[] = [];

  return {
    lookedUp,
    lookUp(text: string): Promise<GeocodedPlace | null> {
      // Recorded before the answer is decided, so a lookup that ends up
      // throwing is still counted as having been asked.
      lookedUp.push(text);

      const answer = table[text];
      if (answer instanceof Error) {
        return Promise.reject(answer);
      }
      return Promise.resolve(answer ?? null);
    },
  };
}
