import { describe, expect, test } from "vitest";
import { parsePriorityEntry, sideRank } from "./source-priority";

// A stand-in list. Order is the whole point: earlier is better.
const LIST = [
  "collector:user",
  "parser:greenhouse",
  "collector:greenhouse",
  "collector:adzuna",
];

describe("parsePriorityEntry", () => {
  test("reads a collector entry", () => {
    expect(parsePriorityEntry("collector:greenhouse")).toEqual({
      kind: "collector",
      name: "greenhouse",
    });
  });

  test("reads a parser entry", () => {
    expect(parsePriorityEntry("parser:greenhouse")).toEqual({
      kind: "parser",
      name: "greenhouse",
    });
  });

  test("reads the hand-entered collector", () => {
    expect(parsePriorityEntry("collector:user")).toEqual({ kind: "collector", name: "user" });
  });

  test("a name holding a colon keeps everything after the first one", () => {
    expect(parsePriorityEntry("collector:a:b")).toEqual({ kind: "collector", name: "a:b" });
  });

  test("an entry with no colon is not an entry", () => {
    expect(parsePriorityEntry("greenhouse")).toBeNull();
  });

  // A side is only ever a collector or a parser, so an entry of any other
  // kind can never match one and is junk the settings check catches.
  test("an entry of an unknown kind is not an entry", () => {
    expect(parsePriorityEntry("widget:greenhouse")).toBeNull();
  });

  test("an entry with no name is not an entry", () => {
    expect(parsePriorityEntry("collector:")).toBeNull();
  });

  test("an entry with no kind is not an entry", () => {
    expect(parsePriorityEntry(":greenhouse")).toBeNull();
  });

  test("an empty string is not an entry", () => {
    expect(parsePriorityEntry("")).toBeNull();
  });
});

describe("sideRank", () => {
  test("a collector on the list ranks at its position", () => {
    expect(sideRank(LIST, { collector: "adzuna" })).toBe(3);
  });

  test("a parser on the list ranks at its position", () => {
    expect(sideRank(LIST, { parser: "greenhouse" })).toBe(1);
  });

  test("earlier in the list beats later", () => {
    const greenhouse = sideRank(LIST, { collector: "greenhouse" });
    const adzuna = sideRank(LIST, { collector: "adzuna" });
    expect(greenhouse).not.toBeNull();
    expect(adzuna).not.toBeNull();
    expect(greenhouse as number).toBeLessThan(adzuna as number);
  });

  // A side a parser read carries that parser's details, so it ranks where the
  // parser sits, whether its collector sits above or below.
  test("a side carrying both ranks by its parser", () => {
    expect(sideRank(LIST, { collector: "adzuna", parser: "greenhouse" })).toBe(1);
  });

  test("a side carrying both ranks by its parser even below its collector", () => {
    expect(sideRank(["collector:greenhouse", "parser:greenhouse"], {
      collector: "greenhouse",
      parser: "greenhouse",
    })).toBe(1);
  });

  test("a side whose parser is absent ranks on its collector alone", () => {
    expect(sideRank(LIST, { collector: "adzuna", parser: "nowhere" })).toBe(3);
  });

  test("a side absent from the list has no rank", () => {
    expect(sideRank(LIST, { collector: "nowhere" })).toBeNull();
  });

  test("a side carrying neither a collector nor a parser has no rank", () => {
    expect(sideRank(LIST, {})).toBeNull();
  });

  test("a null collector and a null parser are the same as none", () => {
    expect(sideRank(LIST, { collector: null, parser: null })).toBeNull();
  });

  test("nothing has a rank against an empty list", () => {
    expect(sideRank([], { collector: "greenhouse" })).toBeNull();
  });

  // The kind is part of the identity. A parser entry does not rank a
  // collector of the same name, or reordering one would silently move both.
  test("a collector does not match a parser entry of the same name", () => {
    expect(sideRank(["parser:greenhouse"], { collector: "greenhouse" })).toBeNull();
  });

  test("a parser does not match a collector entry of the same name", () => {
    expect(sideRank(["collector:greenhouse"], { parser: "greenhouse" })).toBeNull();
  });

  test("a junk entry sitting in the list is skipped rather than counted", () => {
    expect(sideRank(["widget:greenhouse", "collector:greenhouse"], { collector: "greenhouse" })).toBe(
      1
    );
  });
});
