import { describe, expect, test } from "vitest";
import {
  summarizeNormalizationWarnings,
  WARNING_REASONS,
  type UnusableField,
} from "./normalization-warnings";

// Builds N unusable entries for one collector and one reason, with distinct
// example values, so a test naming "the first two examples" does not have to
// list forty literals to prove it.
function buildUnusableEntries(collector: string, reason: string, count: number): UnusableField[] {
  return Array.from({ length: count }, (_, index) => ({
    collector,
    reason,
    example: `example-${index + 1}`,
  }));
}

describe("many unusable entries from one collector and reason fold into a single issue", () => {
  const issues = summarizeNormalizationWarnings(
    buildUnusableEntries("greenhouse", "salary_unusable", 40)
  );

  test("forty entries produce exactly one issue", () => {
    expect(issues).toHaveLength(1);
  });

  test("the issue's collector field is the collector's name", () => {
    expect(issues[0]?.collector).toBe("greenhouse");
  });

  test("the message reports a count of forty", () => {
    // Word boundaries, so "40" is not also matched inside some other number
    // the wording happens to contain.
    expect(issues[0]?.message).toMatch(/\b40\b/);
  });

  test("the message carries the first two examples", () => {
    expect(issues[0]?.message).toContain("example-1");
    expect(issues[0]?.message).toContain("example-2");
  });

  test("the message names the reason", () => {
    expect(issues[0]?.message).toContain("salary_unusable");
  });
});

describe("two collectors with the same reason produce two issues", () => {
  const issues = summarizeNormalizationWarnings([
    ...buildUnusableEntries("greenhouse", "salary_unusable", 3),
    ...buildUnusableEntries("lever", "salary_unusable", 5),
  ]);

  test("one issue exists per collector", () => {
    expect(issues).toHaveLength(2);
  });

  test("each collector gets its own issue rather than sharing one", () => {
    // Sorted, because nothing here depends on which collector's issue comes
    // first — only that a broken source never hides another.
    expect(issues.map((issue) => issue.collector).sort()).toEqual(["greenhouse", "lever"]);
  });
});

describe("one collector with both warning reasons produces two issues", () => {
  const issues = summarizeNormalizationWarnings([
    ...buildUnusableEntries("ashby", "salary_unusable", 2),
    ...buildUnusableEntries("ashby", "work_mode_unusable", 4),
  ]);

  test("one issue exists per reason", () => {
    expect(issues).toHaveLength(2);
  });

  test("both issues are attributed to the same collector", () => {
    expect(issues.every((issue) => issue.collector === "ashby")).toBe(true);
  });

  test("each reason is named in its own issue's message", () => {
    const messages = issues.map((issue) => issue.message);
    expect(messages.some((message) => message.includes("salary_unusable"))).toBe(true);
    expect(messages.some((message) => message.includes("work_mode_unusable"))).toBe(true);
  });
});

describe("nothing unusable produces nothing to print", () => {
  test("an empty input gives an empty array", () => {
    // Not one issue reading zero — nothing at all, so a clean run prints
    // nothing about warnings that never happened.
    expect(summarizeNormalizationWarnings([])).toEqual([]);
  });
});

describe("a reason outside WARNING_REASONS is dropped rather than printed", () => {
  test.each(["title_not_normalized", "salary_partially_normalized", "company_name_normalized"])(
    "entries carrying reason %s produce no issue",
    (reason) => {
      const entries = buildUnusableEntries("adzuna", reason, 5);
      expect(summarizeNormalizationWarnings(entries)).toEqual([]);
    }
  );

  test("a dropped reason alongside a warning reason leaves only the warning reason's issue", () => {
    // Proves the silent reason's entries are not folded into the warning
    // reason's count on their way out.
    const entries = [
      ...buildUnusableEntries("adzuna", "salary_unusable", 2),
      ...buildUnusableEntries("adzuna", "title_not_normalized", 5),
    ];
    const issues = summarizeNormalizationWarnings(entries);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toMatch(/\b2\b/);
  });
});

describe("a single unusable entry still produces an issue", () => {
  const issues = summarizeNormalizationWarnings(
    buildUnusableEntries("jsearch", "work_mode_unusable", 1)
  );

  test("exactly one issue is produced", () => {
    expect(issues).toHaveLength(1);
  });

  test("the message reports a count of one", () => {
    expect(issues[0]?.message).toMatch(/\b1\b/);
  });

  test("the message carries the single example", () => {
    expect(issues[0]?.message).toContain("example-1");
  });

  test("no second example is invented when only one exists", () => {
    expect(issues[0]?.message).not.toContain("example-2");
  });

  test("one job reads as a job rather than jobs", () => {
    // This line is printed to the user during a real search, so it reads as
    // a sentence rather than as a counter.
    expect(issues[0]?.message).not.toContain("1 jobs");
  });
});

describe("more than two examples available still yields only the first two", () => {
  const issues = summarizeNormalizationWarnings(
    buildUnusableEntries("dribbble", "salary_unusable", 5)
  );

  test("the third example onward is left out of the message", () => {
    expect(issues[0]?.message).not.toContain("example-3");
    expect(issues[0]?.message).not.toContain("example-4");
    expect(issues[0]?.message).not.toContain("example-5");
  });
});

describe("the returned collector field is the collector's name and nothing else", () => {
  test("no reason or other text is appended to it", () => {
    // The orchestrator prints a warning's collector field directly, so these
    // issues need no special case there.
    const entries = buildUnusableEntries("uiuxjobsboard", "work_mode_unusable", 1);
    expect(summarizeNormalizationWarnings(entries)[0]?.collector).toBe("uiuxjobsboard");
  });
});

describe("WARNING_REASONS names exactly the two reasons that ever warn", () => {
  test("it holds salary_unusable and work_mode_unusable and nothing else", () => {
    expect(WARNING_REASONS).toEqual(["salary_unusable", "work_mode_unusable"]);
  });
});

describe("every reason in WARNING_REASONS produces an issue on its own", () => {
  test.each(WARNING_REASONS)("a single %s entry produces one issue naming that reason", (reason) => {
    const issues = summarizeNormalizationWarnings(buildUnusableEntries("lever", reason, 1));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain(reason);
  });
});

describe("realistic unusable examples pass through the message verbatim", () => {
  // The exact shapes the normalizer records as detail.from — raw strings, not
  // parsed values, so the message is checked for the string itself rather
  // than anything derived from it.
  test.each([
    ["salary_unusable", '{"salary_period":"YEAR","salary_currency":"USD"}', '{"salary_currency":"GBP"}'],
    ["work_mode_unusable", '["flexible"]', '["Anywhere"]'],
  ])("a %s issue's message carries both raw examples unchanged", (reason, first, second) => {
    const entries: UnusableField[] = [
      { collector: "greenhouse", reason, example: first },
      { collector: "greenhouse", reason, example: second },
    ];
    const issues = summarizeNormalizationWarnings(entries);
    expect(issues[0]?.message).toContain(first);
    expect(issues[0]?.message).toContain(second);
  });
});
