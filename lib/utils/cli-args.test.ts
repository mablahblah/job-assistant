// Five commands each held their own byte-for-byte copy of this. One shared
// version means a change to how an option is read reaches every command,
// rather than five places one of which gets missed.
import { describe, expect, test } from "vitest";
import { flagValue } from "./cli-args";

describe("reading one option off the command line", () => {
  test("the value after the named option is handed back", () => {
    expect(flagValue(["--company", "Figma"], "company")).toBe("Figma");
  });

  test("the option can sit anywhere in the line", () => {
    expect(flagValue(["--json", "--company", "Figma"], "company")).toBe("Figma");
  });

  // Undefined rather than empty, so the caller decides what an absent option
  // means — some refuse, some carry on.
  test("an option that is not there reads as absent", () => {
    expect(flagValue(["--json"], "company")).toBeUndefined();
  });

  test("an empty command line reads as absent", () => {
    expect(flagValue([], "company")).toBeUndefined();
  });

  // A flag at the very end has nothing after it, which reads as absent
  // rather than as an empty answer.
  test("an option with nothing after it reads as absent", () => {
    expect(flagValue(["--company"], "company")).toBeUndefined();
  });

  test("the first of two spellings of one option wins", () => {
    expect(flagValue(["--company", "Figma", "--company", "Linear"], "company")).toBe("Figma");
  });

  // Names are matched whole, so asking for one option never reads another
  // whose name merely starts the same way.
  test("an option whose name starts the same way is not read", () => {
    expect(flagValue(["--company-name", "Figma"], "company")).toBeUndefined();
  });
});
