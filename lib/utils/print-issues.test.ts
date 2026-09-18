// Three commands each held their own byte-for-byte copy of this. One shared
// version means the shape of a reported problem changes in one place rather
// than three, one of which gets missed.
import { describe, expect, test } from "vitest";
import { issueLines } from "./print-issues";

describe("listing the problems a run reported", () => {
  // Said out loud rather than left blank, because a heading with nothing
  // under it reads as a run that printed badly rather than one that had
  // nothing to report.
  test("a run with no problems says so under its heading", () => {
    expect(issueLines("Warnings", [])).toEqual(["Warnings: none"]);
  });

  test("one problem is listed under its heading", () => {
    expect(issueLines("Warnings", [{ collector: "adzuna", message: "ran out of pages" }])).toEqual([
      "Warnings:",
      "  adzuna: ran out of pages",
    ]);
  });

  // The source is named on every line, because thirteen employers can sit
  // behind one source and the message is what names the board or the search.
  test("every line names the source that produced it", () => {
    const lines = issueLines("Errors", [
      { collector: "adzuna", message: "first problem" },
      { collector: "greenhouse", message: "second problem" },
    ]);

    expect(lines).toEqual([
      "Errors:",
      "  adzuna: first problem",
      "  greenhouse: second problem",
    ]);
  });

  test("two problems from one source are two lines rather than a count", () => {
    const lines = issueLines("Warnings", [
      { collector: "adzuna", message: "first problem" },
      { collector: "adzuna", message: "second problem" },
    ]);

    expect(lines).toHaveLength(3);
  });

  test("the heading is whatever the caller named it", () => {
    expect(issueLines("Errors", [])).toEqual(["Errors: none"]);
  });
});
