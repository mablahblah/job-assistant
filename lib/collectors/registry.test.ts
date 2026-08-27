import { describe, expect, test } from "vitest";
import { COLLECTORS } from "./registry";

// The registry is empty until later tasks add collectors to it, so most of
// these pass vacuously for now. They exist to catch a bad name the moment a
// collector is registered.
describe("AC 25: every collector's name is set and canonical", () => {
  test("every collector has a non-empty name", () => {
    const unnamed = COLLECTORS.filter((collector) => collector.name.trim() === "");
    expect(unnamed).toEqual([]);
  });

  test("no collector's name ends in '-api'", () => {
    // The old pipeline wrote "greenhouse-api" while its orchestrator recorded
    // "greenhouse", so nothing could join a job to the collector that found
    // it. Collecting the offending names puts them in the failure message.
    const offenders = COLLECTORS.filter((collector) => collector.name.endsWith("-api")).map(
      (collector) => collector.name
    );
    expect(offenders).toEqual([]);
  });

  test("every name is unique across the registry", () => {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const collector of COLLECTORS) {
      if (seen.has(collector.name)) {
        duplicates.add(collector.name);
      }
      seen.add(collector.name);
    }
    // A repeated name makes a job's collector field ambiguous, so any
    // duplicate found is named in the assertion.
    expect([...duplicates]).toEqual([]);
  });

  test("every collector exposes a collect function", () => {
    const missingCollect = COLLECTORS.filter(
      (collector) => typeof collector.collect !== "function"
    ).map((collector) => collector.name);
    expect(missingCollect).toEqual([]);
  });
});
