import { describe, expect, test } from "vitest";
import fixture from "./description-fields.fixture.json";
import { readWorkModeFromText, type WorkMode } from "./work-mode";

describe("AC 92: a description naming a work mode has it read", () => {
  test("a description saying this role is remote reads as remote", () => {
    expect(readWorkModeFromText("This role is remote and based in the US.")).toBe("remote");
  });
});

describe("AC 94: a description saying nothing about where the work happens reads as nothing", () => {
  test("no mode is guessed", () => {
    expect(
      readWorkModeFromText("We are looking for someone who loves solving hard problems.")
    ).toBeUndefined();
  });
});

describe("the description is read exactly as a collector stored it", () => {
  test("markup is decoded before the mode is looked for", () => {
    const html = "<p>About the team</p><p>This role is remote and based in the US.</p>";
    expect(readWorkModeFromText(html)).toBe("remote");
  });
});

describe("the three words written out are remote, hybrid and in-person", () => {
  // The database holds only these three, so every other spelling a source
  // publishes is translated onto them.
  const cases: Array<{ text: string; expected: WorkMode }> = [
    { text: "This role is onsite.", expected: "in-person" },
    { text: "This role is on-site.", expected: "in-person" },
    { text: "This role is On-Site.", expected: "in-person" },
    { text: "This role is in-person.", expected: "in-person" },
  ];

  test.each(cases)("$text reads as $expected", ({ text, expected }) => {
    expect(readWorkModeFromText(text)).toBe(expected);
  });
});

describe("a deliberate hashtag is the strongest signal", () => {
  const cases: Array<{ text: string; expected: WorkMode }> = [
    { text: "Learn more about this role. #LI-Remote Apply today.", expected: "remote" },
    { text: "Learn more about this role. #LI-Hybrid Apply today.", expected: "hybrid" },
    { text: "Learn more about this role. #LI-Onsite Apply today.", expected: "in-person" },
    { text: "Learn more about this role. #Remote Apply today.", expected: "remote" },
    { text: "Learn more about this role. #Hybrid Apply today.", expected: "hybrid" },
    { text: "Learn more about this role. #Onsite Apply today.", expected: "in-person" },
  ];

  test.each(cases)("$text reads as $expected", ({ text, expected }) => {
    expect(readWorkModeFromText(text)).toBe(expected);
  });

  test("the hashtag is matched whatever its capitalisation", () => {
    expect(readWorkModeFromText("Apply now. #li-remote See you soon.")).toBe("remote");
  });

  test("the #LI-KM3 recruiter code names no mode", () => {
    expect(readWorkModeFromText("Great opportunity. #LI-KM3 Apply now.")).toBeUndefined();
  });

  test("the #LI-DNI recruiter code names no mode", () => {
    expect(readWorkModeFromText("Great opportunity. #LI-DNI Apply now.")).toBeUndefined();
  });

  test("a hashtag wins over a passing mention elsewhere in the text", () => {
    expect(readWorkModeFromText("We are proud of GitLab's remote culture. #LI-Hybrid")).toBe(
      "hybrid"
    );
  });

  test("a hashtag wins even where a phrase in the same text names another mode", () => {
    // Lyft publishes exactly this pairing, and the hashtag is the one telling
    // the truth: "in this hybrid role" there means a blend of duties. The two
    // signals disagree in 2 of the 4,661 descriptions measured, so which wins
    // decides almost nothing, but it is settled here rather than by accident.
    const text = "This role is fully remote in Colorado. #Remote In this hybrid role, you balance outreach.";
    expect(readWorkModeFromText(text)).toBe("remote");
  });
});

describe("a phrase anchored to the role is read where no hashtag appears", () => {
  const cases: Array<{ text: string; expected: WorkMode }> = [
    { text: "This role is remote", expected: "remote" },
    { text: "This role will be 100% remote", expected: "remote" },
    { text: "This is a remote role", expected: "remote" },
    { text: "This remote role reports to a team lead", expected: "remote" },
    { text: "This position is fully remote as long as you work within CET", expected: "remote" },
    { text: "This is a hybrid role", expected: "hybrid" },
    { text: "This position is hybrid", expected: "hybrid" },
    { text: "We offer a hybrid schedule", expected: "hybrid" },
    { text: "We use a hybrid working model", expected: "hybrid" },
    { text: "This is an onsite role", expected: "in-person" },
    { text: "This is a full time, on-site position", expected: "in-person" },
    { text: "This is an in-person role with regular collaboration", expected: "in-person" },
  ];

  test.each(cases)("$text reads as $expected", ({ text, expected }) => {
    expect(readWorkModeFromText(text)).toBe(expected);
  });

  test("a role-anchored phrase wins over a passing mention elsewhere in the text", () => {
    const text = "GitLab's remote culture is well known. This role is hybrid and based in Berlin.";
    expect(readWorkModeFromText(text)).toBe("hybrid");
  });
});

describe("a passing mention of the word is not a statement of this role's mode", () => {
  // "remote" appears in 1,649 of the 4,661 descriptions measured, almost
  // always as talk about the company rather than about this job.
  test.each([
    "GitLab team members work in a remote, asynchronous, and values-driven environment.",
    "GitLab's remote culture helps us build things differently.",
    "All of our roles are remote, however some roles may require travel.",
  ])("company talk about remote working names no mode: %s", (text) => {
    expect(readWorkModeFromText(text)).toBeUndefined();
  });

  test.each([
    "Our Gaming team is made up of hybrid-casual, casual and midcore experts.",
    "We are looking for someone with a design/development hybrid background.",
    "This role is a hybrid mix of program management, project management, and creative work.",
  ])("hybrid used to mean a blend of things names no mode: %s", (text) => {
    expect(readWorkModeFromText(text)).toBeUndefined();
  });
});

describe("the fixture of real excerpts from the boards this pipeline polls", () => {
  const modeCases = fixture.mode;
  const neitherCases = fixture.neither;

  // An emptied or broken fixture would let both sweeps below pass while
  // checking nothing, so both groups have to actually hold cases.
  test("the fixture holds both mode cases and cases naming neither", () => {
    expect(modeCases.length).toBeGreaterThan(0);
    expect(neitherCases.length).toBeGreaterThan(0);
  });

  test("every excerpt naming a mode is read as that mode", () => {
    const missed = modeCases
      .map((one) => ({
        source: one.source,
        expected: one.expect,
        got: readWorkModeFromText(one.text),
      }))
      .filter(({ expected, got }) => got !== expected);
    // Collecting the offending cases rather than counting them means a
    // failure names the board and what was read, instead of leaving it to be
    // worked out again.
    expect(missed).toEqual([]);
  });

  test("no excerpt naming neither is read as a mode", () => {
    const wronglyRead = neitherCases
      .map((one) => ({ source: one.source, got: readWorkModeFromText(one.text) }))
      .filter(({ got }) => got !== undefined);
    expect(wronglyRead).toEqual([]);
  });
});
