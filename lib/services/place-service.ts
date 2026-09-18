// Owns every read and write of the Place table. Nothing else in the codebase
// talks to Place directly. The table exists because geocoding is paced to one
// request a second, but postings repeat the same handful of places: across
// the real database, 3,975 lookups resolve to only 789 distinct places — so a
// place is looked up once and reused from here on out.
import { Prisma } from "../../generated/pipeline/client";
import type { createPipelineDb } from "../db/pipeline-db";
import type { GeocodedPlace } from "../tools/geocoder";
import type { MapShape } from "../utils/point-in-shape";

export interface PlaceRecord {
  lookup_text: string;
  latitude: number;
  longitude: number;
  place_type: string;
  display_name: string;
  outline: MapShape | null;
}

export interface PlaceService {
  findByText(text: string): Promise<PlaceRecord | null>;
  store(text: string, place: GeocodedPlace | null): Promise<void>;
}

type PipelineDb = ReturnType<typeof createPipelineDb>;

// Every read below selects exactly these columns, so the shape handed back
// always matches PlaceRecord regardless of what else the schema grows — id
// and created_at are deliberately left out, they are not part of the record.
const SELECT = {
  lookup_text: true,
  latitude: true,
  longitude: true,
  place_type: true,
  display_name: true,
  outline: true,
} as const;

// Prisma types a Json? column as JsonValue on the way out, which could in
// principle be any JSON value at all. This checks the shape we actually wrote
// is still there before handing it back as MapShape, instead of casting blind.
function toMapShape(value: Prisma.JsonValue): MapShape | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record["type"] !== "string" || !("coordinates" in record)) {
    return null;
  }
  return { type: record["type"], coordinates: record["coordinates"] };
}

// MapShape's coordinates is unknown, which is not assignable to Prisma's
// InputJsonValue directly, and writing a JSON null needs Prisma.JsonNull
// rather than a plain null — a plain null would mean "leave the column alone".
function toInputJson(outline: MapShape | null): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return outline === null ? Prisma.JsonNull : (outline as unknown as Prisma.InputJsonValue);
}

export function createPlaceService(db: PipelineDb): PlaceService {
  return {
    async findByText(text) {
      const row = await db.place.findUnique({
        where: { lookup_text: text },
        select: SELECT,
      });
      if (!row) {
        return null;
      }
      return { ...row, outline: toMapShape(row.outline) };
    },

    async store(text, place) {
      // Nothing resolved — write no row, so the same text is tried again
      // next run instead of being remembered as a permanent miss.
      if (!place) {
        return;
      }
      const fields = {
        latitude: place.latitude,
        longitude: place.longitude,
        place_type: place.place_type,
        display_name: place.display_name,
        outline: toInputJson(place.outline),
      };
      await db.place.upsert({
        where: { lookup_text: text },
        create: { lookup_text: text, ...fields },
        update: fields,
      });
    },
  };
}
