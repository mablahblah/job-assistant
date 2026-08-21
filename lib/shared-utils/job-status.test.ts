import { describe, it, expect } from "vitest";
import {
  BACKLOG_STATUS,
  ACTIVE_STATUSES,
  DISQUALIFIED_STATUSES,
  REPLACEABLE_STATUSES,
  ALL_STATUSES,
  isActiveStatus,
  isReplaceableStatus,
  isValidStatus,
} from "./job-status";

// The ten statuses from prisma/schema.prisma Job.status, split by expected group.
const ACTIVE = ["app. sent", "screening", "interview", "test", "offer"];
const REPLACEABLE = ["backlog", "too far", "expired", "won't apply", "rejected"];

describe("status groups", () => {
  it("names the backlog status", () => {
    expect(BACKLOG_STATUS).toBe("backlog");
  });

  it("lists exactly the five active statuses", () => {
    expect([...ACTIVE_STATUSES].sort()).toEqual([...ACTIVE].sort());
  });

  it("lists the four disqualified statuses", () => {
    expect([...DISQUALIFIED_STATUSES].sort()).toEqual(
      ["too far", "expired", "won't apply", "rejected"].sort(),
    );
  });

  it("makes replaceable the backlog status plus the disqualified ones", () => {
    expect([...REPLACEABLE_STATUSES].sort()).toEqual([...REPLACEABLE].sort());
  });

  it("covers all ten statuses with no duplicates", () => {
    expect(ALL_STATUSES).toHaveLength(10);
    expect(new Set(ALL_STATUSES).size).toBe(10);
  });

  it("makes active and replaceable exact complements", () => {
    const combined = [...ACTIVE_STATUSES, ...REPLACEABLE_STATUSES].sort();
    expect(combined).toEqual([...ALL_STATUSES].sort());
  });

  it("shares no status between active and replaceable", () => {
    const overlap = ACTIVE_STATUSES.filter((s) => REPLACEABLE_STATUSES.includes(s));
    expect(overlap).toEqual([]);
  });
});

describe("isActiveStatus", () => {
  for (const status of ACTIVE) {
    it(`returns true for "${status}"`, () => {
      expect(isActiveStatus(status)).toBe(true);
    });
  }

  for (const status of REPLACEABLE) {
    it(`returns false for "${status}"`, () => {
      expect(isActiveStatus(status)).toBe(false);
    });
  }

  it("returns false for an unknown status", () => {
    expect(isActiveStatus("interviewing")).toBe(false);
  });
});

describe("isReplaceableStatus", () => {
  for (const status of REPLACEABLE) {
    it(`returns true for "${status}"`, () => {
      expect(isReplaceableStatus(status)).toBe(true);
    });
  }

  for (const status of ACTIVE) {
    it(`returns false for "${status}"`, () => {
      expect(isReplaceableStatus(status)).toBe(false);
    });
  }

  it("returns false for an unknown status", () => {
    expect(isReplaceableStatus("applied")).toBe(false);
  });
});

describe("isValidStatus", () => {
  for (const status of [...ACTIVE, ...REPLACEABLE]) {
    it(`returns true for "${status}"`, () => {
      expect(isValidStatus(status)).toBe(true);
    });
  }

  it("returns false for a near-miss status name", () => {
    expect(isValidStatus("interviewing")).toBe(false);
  });

  it("returns false for the empty string", () => {
    expect(isValidStatus("")).toBe(false);
  });
});
