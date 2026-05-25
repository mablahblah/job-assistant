import { describe, it, expect } from "vitest";
import { classifyLocation } from "./location";

describe("classifyLocation", () => {
  // --- Non-remote jobs: pass through (geo handles them now) ---
  it("in-person passes through (geo classification handles this)", () => {
    expect(classifyLocation("in-person", "New York, NY")).toEqual({ tooFar: false });
  });
  it("hybrid passes through (geo classification handles this)", () => {
    expect(classifyLocation("hybrid", "Dallas, TX")).toEqual({ tooFar: false });
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

  // --- Empty workMode: takes remote path ---
  it("empty workMode + Austin → eligible (matches via REMOTE_ELIGIBLE_KEYWORDS)", () => {
    expect(classifyLocation("", "Austin, TX")).toEqual({ tooFar: false });
  });
  it("empty workMode + non-matching city → too far", () => {
    expect(classifyLocation("", "San Francisco, CA")).toEqual({ tooFar: true, flagged: false });
  });
  it("empty workMode + bare 'US' → eligible", () => {
    expect(classifyLocation("", "US")).toEqual({ tooFar: false });
  });
  it("empty workMode + 'US / Canada' → eligible", () => {
    expect(classifyLocation("", "US / Canada")).toEqual({ tooFar: false });
  });
  it("empty workMode + 'Remote' → eligible", () => {
    expect(classifyLocation("", "Remote")).toEqual({ tooFar: false });
  });
  it("empty workMode + empty location → eligible", () => {
    expect(classifyLocation("", "")).toEqual({ tooFar: false });
  });
  it("empty workMode + international location → too far", () => {
    expect(classifyLocation("", "London, United Kingdom")).toEqual({ tooFar: true, flagged: false });
  });
});
