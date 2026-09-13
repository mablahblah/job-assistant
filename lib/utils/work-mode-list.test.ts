import { describe, expect, test } from "vitest";
import { normalizeModeList } from "./work-mode-list";
import type { WorkMode } from "./work-mode";

describe("a recognised word is translated to its database spelling", () => {
  test("Remote gives remote", () => {
    expect(normalizeModeList(["Remote"])).toEqual(["remote"]);
  });

  test("Hybrid gives hybrid", () => {
    expect(normalizeModeList(["Hybrid"])).toEqual(["hybrid"]);
  });

  test.each(["onsite", "OnSite", "on-site"])("%s gives in-person", (word) => {
    expect(normalizeModeList([word])).toEqual(["in-person"]);
  });
});

describe("duplicate entries collapse to one", () => {
  test("Remote and remote together give a single remote entry", () => {
    expect(normalizeModeList(["Remote", "remote"])).toEqual(["remote"]);
  });

  test("Hybrid and hybrid together give a single hybrid entry", () => {
    expect(normalizeModeList(["Hybrid", "hybrid"])).toEqual(["hybrid"]);
  });
});

describe("an unrecognised word is dropped, not guessed at", () => {
  test("a recognised word alongside an unrecognised one keeps only the recognised word", () => {
    expect(normalizeModeList(["Remote", "flexible"])).toEqual(["remote"]);
  });

  // work-mode.ts's own normalizeMode turns every unmatched word into
  // "in-person", because its caller only ever hands it a word a regex has
  // already matched. A source here can send anything, so that default must
  // not leak in: each of these comes back empty rather than folded into
  // in-person.
  test.each(["flexible", "Anywhere", "WFH", "Field"])(
    "%s alone gives an empty list, never in-person",
    (word) => {
      expect(normalizeModeList([word])).toEqual([]);
    }
  );
});

describe("an empty input list gives an empty output list", () => {
  test("no raw words in gives no words out", () => {
    expect(normalizeModeList([])).toEqual([]);
  });
});

describe("the output follows the order of the input", () => {
  test("the same modes given in a different order come back in that different order", () => {
    // Normalization runs a second time over unchanged raw fields and has to
    // produce an identical result. Sorting or grouping the output would make
    // a job look changed when nothing about it did.
    expect(normalizeModeList(["Hybrid", "Remote"])).toEqual(["hybrid", "remote"]);
    expect(normalizeModeList(["Remote", "Hybrid"])).toEqual(["remote", "hybrid"]);
  });
});

describe("the real spellings these sources publish", () => {
  test.each([
    ["Ashby", ["Remote", "OnSite", "Hybrid"], ["remote", "in-person", "hybrid"]],
    ["Lever", ["remote", "onsite"], ["remote", "in-person"]],
    ["JSearch", ["remote"], ["remote"]],
  ])("%s's words are read correctly", (_source, raw, expected) => {
    expect(normalizeModeList(raw)).toEqual(expected);
  });
});

describe("every word the description reader can return survives normalization", () => {
  // readWorkModeFromText returns a WorkMode or nothing, so these three words
  // are the whole of what a description can hand over. Writing them as the
  // keys of a Record<WorkMode, ...> means a fourth mode added to the type
  // fails to compile here until this list names it too.
  const EVERY_READER_ANSWER: Record<WorkMode, WorkMode> = {
    remote: "remote",
    hybrid: "hybrid",
    "in-person": "in-person",
  };

  test.each(Object.entries(EVERY_READER_ANSWER))(
    "%s read out of a description gives %s",
    (word, expected) => {
      expect(normalizeModeList([word])).toEqual([expected]);
    }
  );
});
