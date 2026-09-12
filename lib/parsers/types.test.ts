import { describe, expect, expectTypeOf, test } from "vitest";
import type { ParseResult, Parser, ParserContext } from "./types";

// A stand-in written the way a real parser is, so the contract is exercised
// rather than only described.
const stubParser: Parser = {
  name: "stub",
  async parse({ url }) {
    return { raw_title: `read from ${url}` };
  },
};

describe("Parser: a parser is handed a resolved link and hands back fields", () => {
  test("the stand-in reads the link it was given", async () => {
    await expect(stubParser.parse({ url: "https://example.com/jobs/1" })).resolves.toEqual({
      raw_title: "read from https://example.com/jobs/1",
    });
  });

  test("a parser that found nothing hands back an empty set of fields", async () => {
    const empty: Parser = { name: "empty", parse: async () => ({}) };

    await expect(empty.parse({ url: "https://example.com/jobs/1" })).resolves.toEqual({});
  });
});

describe("Parser: the contract carries only what a parser owns", () => {
  test("a parser is handed the resolved link and nothing else", () => {
    expectTypeOf<ParserContext>().toEqualTypeOf<{ url: string }>();
  });

  // The handler holds the link and closes the parsing gate. A parser handing
  // either back would let it overwrite work that is not its own. Each line
  // below fails the typecheck if the field ever becomes assignable, because
  // an expect-error directive is itself an error when there is nothing to
  // expect.
  test("what a parse hands back carries no link and no phase gate", () => {
    // @ts-expect-error a parse carries no link
    const withLink: ParseResult = { resolved_url: "https://example.com/jobs/1" };
    // @ts-expect-error a parse carries no link
    const withOriginal: ParseResult = { original_url: "https://example.com/jobs/1" };
    // @ts-expect-error a parse carries no phase gate
    const withParsed: ParseResult = { is_parsed: true };
    // @ts-expect-error a parse carries no phase gate
    const withResolved: ParseResult = { is_resolved: true };
    // @ts-expect-error a parse carries no phase gate
    const withClassified: ParseResult = { is_classified: true };

    expect([withLink, withOriginal, withParsed, withResolved, withClassified]).toHaveLength(5);
  });

  test("a parser names itself, so its fields can be weighed against a collector's", () => {
    expectTypeOf<Parser["name"]>().toEqualTypeOf<string>();
  });
});
