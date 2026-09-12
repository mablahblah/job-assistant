import { describe, expect, test } from "vitest";
import { ACTIVE_STATUSES, isActiveStatus } from "./job-status";

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
