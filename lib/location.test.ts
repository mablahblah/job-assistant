import { describe, it, expect } from "vitest";
import { classifyLocation } from "./location";

describe("classifyLocation", () => {
  // --- In-person jobs ---
  it("in-person in Austin → eligible", () => {
    expect(classifyLocation("in-person", "Austin, TX")).toEqual({ tooFar: false });
  });
  it("in-person in Round Rock → eligible", () => {
    expect(classifyLocation("in-person", "Round Rock, TX")).toEqual({ tooFar: false });
  });
  it("in-person in NYC → too far", () => {
    expect(classifyLocation("in-person", "New York, NY")).toEqual({ tooFar: true, flagged: false });
  });
  it("unknown workMode in Austin → eligible", () => {
    expect(classifyLocation("", "Austin, TX")).toEqual({ tooFar: false });
  });
  it("unknown workMode outside Austin → too far", () => {
    expect(classifyLocation("", "San Francisco, CA")).toEqual({ tooFar: true, flagged: false });
  });

  // --- Hybrid jobs ---
  it("hybrid in Austin → eligible", () => {
    expect(classifyLocation("hybrid", "Austin, TX")).toEqual({ tooFar: false });
  });
  it("hybrid in Cedar Park → eligible", () => {
    expect(classifyLocation("hybrid", "Cedar Park, TX")).toEqual({ tooFar: false });
  });
  it("hybrid in Dallas → too far", () => {
    expect(classifyLocation("hybrid", "Dallas, TX")).toEqual({ tooFar: true, flagged: false });
  });

  // --- Remote jobs: inclusion list ---
  it("remote with no location → eligible", () => {
    expect(classifyLocation("remote", "")).toEqual({ tooFar: false });
  });
  it("remote with 'Remote' → eligible", () => {
    expect(classifyLocation("remote", "Remote")).toEqual({ tooFar: false });
  });
  it("remote US → eligible", () => {
    expect(classifyLocation("remote", "Remote, US")).toEqual({ tooFar: false });
  });
  it("remote United States → eligible", () => {
    expect(classifyLocation("remote", "Remote, United States")).toEqual({ tooFar: false });
  });
  it("remote Austin → eligible", () => {
    expect(classifyLocation("remote", "Remote - Austin, TX")).toEqual({ tooFar: false });
  });
  it("remote CST → eligible", () => {
    expect(classifyLocation("remote", "Remote (CST)")).toEqual({ tooFar: false });
  });
  it("remote Texas → eligible", () => {
    expect(classifyLocation("remote", "Texas, US")).toEqual({ tooFar: false });
  });
  it("remote Anywhere → eligible", () => {
    expect(classifyLocation("remote", "Anywhere")).toEqual({ tooFar: false });
  });

  // --- Remote jobs: exclusion list ---
  it("remote UK → too far", () => {
    expect(classifyLocation("remote", "Remote, UK")).toEqual({ tooFar: true, flagged: false });
  });
  it("remote United Kingdom → too far", () => {
    expect(classifyLocation("remote", "London, United Kingdom")).toEqual({ tooFar: true, flagged: false });
  });
  it("remote Canada → too far", () => {
    expect(classifyLocation("remote", "Remote, Canada")).toEqual({ tooFar: true, flagged: false });
  });
  it("remote Europe → too far", () => {
    expect(classifyLocation("remote", "Remote - Europe")).toEqual({ tooFar: true, flagged: false });
  });
  it("remote EMEA → too far", () => {
    expect(classifyLocation("remote", "EMEA")).toEqual({ tooFar: true, flagged: false });
  });
  it("remote EST timezone → too far", () => {
    expect(classifyLocation("remote", "Remote (EST)")).toEqual({ tooFar: true, flagged: false });
  });

  // --- Remote jobs: not on approved list → too far ---
  it("remote with unrecognized city → too far", () => {
    expect(classifyLocation("remote", "San Francisco, CA")).toEqual({ tooFar: true, flagged: false });
  });
  it("remote with unrecognized location → too far", () => {
    expect(classifyLocation("remote", "Mountain View")).toEqual({ tooFar: true, flagged: false });
  });
  it("remote in Manila → too far", () => {
    expect(classifyLocation("remote", "Manila, Philippines")).toEqual({ tooFar: true, flagged: false });
  });
  it("remote in Poland → too far", () => {
    expect(classifyLocation("remote", "Remote - Poland")).toEqual({ tooFar: true, flagged: false });
  });
});
