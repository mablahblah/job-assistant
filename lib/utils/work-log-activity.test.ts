import { describe, expect, test } from "vitest";
import { activityFromStatus } from "./work-log-activity";
import { VALID_STATUSES, WORK_LOG_STATUSES } from "./job-status";

// Criteria 19, 20 and 21. The wording is the form's, not ours: a Texas
// Workforce Commission filing is rejected on language it does not recognize,
// so these three strings are fixed values rather than labels anyone may
// reword.
describe("the activity wording an arriving status produces", () => {
  test("app. sent reads Applied for job", () => {
    expect(activityFromStatus("app. sent")).toBe("Applied for job");
  });

  test("screening reads Had phone screen", () => {
    expect(activityFromStatus("screening")).toBe("Had phone screen");
  });

  test("interview reads Had interview", () => {
    expect(activityFromStatus("interview")).toBe("Had interview");
  });
});

describe("a status that is not a search activity", () => {
  const notActivities = VALID_STATUSES.filter(
    (status) => !(WORK_LOG_STATUSES as readonly string[]).includes(status)
  );

  test.each(notActivities)("%s produces no wording", (status) => {
    expect(activityFromStatus(status)).toBeUndefined();
  });

  // A status nothing recognizes must not be given wording either. Wording is
  // what makes an entry writable, so inventing some here would file an
  // activity for a typo.
  test("a status on no list produces no wording", () => {
    expect(activityFromStatus("applied")).toBeUndefined();
  });
});

// The three statuses are declared once, in job-status.ts. This holds the
// wording against that list so a status added there without wording here
// fails the suite rather than silently writing no entry.
describe("every search activity has wording", () => {
  test.each([...WORK_LOG_STATUSES])("%s produces wording", (status) => {
    expect(activityFromStatus(status)).toBeTypeOf("string");
  });
});

// A status arrives as text the user typed. A plain JavaScript object answers
// yes when asked whether it holds "constructor" or "toString", and hands back
// a function, so a lookup that trusts the object would return one of those
// where wording was expected.
describe("a status naming something every object carries", () => {
  test.each(["constructor", "toString", "valueOf", "__proto__"])(
    "%s produces no wording",
    (status) => {
      expect(activityFromStatus(status)).toBeUndefined();
    }
  );
});
