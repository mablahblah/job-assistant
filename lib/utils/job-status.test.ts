import { describe, expect, test } from "vitest";
import {
  ACTIVE_STATUSES,
  VALID_STATUSES,
  WORK_LOG_STATUSES,
  isActiveStatus,
  isValidStatus,
  isWorkLogStatus,
} from "./job-status";

// The seven statuses that are not active. A rejected job is not active: the
// spec defines active as applied and not rejected, so a rejected row is
// freely updatable.
const NON_ACTIVE_STATUSES = [
  "backlog",
  "expired",
  "too far",
  "won't apply",
  "unresolvable",
  "unparseable",
  "rejected",
];

describe("the active status list", () => {
  test("holds exactly the five statuses that mean the user has applied", () => {
    expect([...ACTIVE_STATUSES]).toEqual([
      "app. sent",
      "screening",
      "interview",
      "test",
      "offer",
    ]);
  });
});

describe("isActiveStatus", () => {
  test.each([...ACTIVE_STATUSES])("%s is active", (status) => {
    expect(isActiveStatus(status)).toBe(true);
  });

  test.each(NON_ACTIVE_STATUSES)("%s is not active", (status) => {
    expect(isActiveStatus(status)).toBe(false);
  });

  // A status the list has never seen is not active. Save's guardrail freezes a
  // row it reports active, so guessing yes here would freeze a row on a
  // typo.
  test("a status not on either list is not active", () => {
    expect(isActiveStatus("something else")).toBe(false);
  });
});

// Criterion 3. A typo reaching the database would put a job into a state no
// query reads, so the list a status is checked against is the list the
// database itself accepts.
describe("the valid status list", () => {
  test("holds exactly the twelve statuses the database accepts", () => {
    expect([...VALID_STATUSES]).toEqual([
      "backlog",
      "expired",
      "too far",
      "won't apply",
      "unresolvable",
      "unparseable",
      "rejected",
      "app. sent",
      "screening",
      "interview",
      "test",
      "offer",
    ]);
  });

  test("holds every active status", () => {
    for (const status of ACTIVE_STATUSES) {
      expect([...VALID_STATUSES]).toContain(status);
    }
  });
});

describe("isValidStatus", () => {
  test.each([...VALID_STATUSES])("%s is valid", (status) => {
    expect(isValidStatus(status)).toBe(true);
  });

  test("a status the list has never seen is not valid", () => {
    expect(isValidStatus("applied")).toBe(false);
  });
});

// Criterion 18. Texas counts search activities rather than job states, so
// this is not the active list: test and offer are active without being
// activities. Two lists typed apart would drift by one character and a legal
// record would quietly stop being written.
describe("the work log status list", () => {
  test("holds exactly the three statuses Texas counts as a search activity", () => {
    expect([...WORK_LOG_STATUSES]).toEqual(["app. sent", "screening", "interview"]);
  });

  test("holds only statuses the database accepts", () => {
    for (const status of WORK_LOG_STATUSES) {
      expect([...VALID_STATUSES]).toContain(status);
    }
  });
});

describe("isWorkLogStatus", () => {
  test.each([...WORK_LOG_STATUSES])("%s writes a work log entry", (status) => {
    expect(isWorkLogStatus(status)).toBe(true);
  });

  test.each(["backlog", "expired", "too far", "won't apply", "unresolvable", "unparseable", "rejected", "test", "offer"])(
    "%s writes no work log entry",
    (status) => {
      expect(isWorkLogStatus(status)).toBe(false);
    }
  );

  test("a status not on any list writes no work log entry", () => {
    expect(isWorkLogStatus("something else")).toBe(false);
  });
});
