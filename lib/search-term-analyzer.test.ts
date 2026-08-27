import { describe, expect, test } from "vitest";
import { analyze, matchesSearchTerms } from "./search-term-analyzer";
import fixture from "./ux-titles.fixture.json";

// Every distinct title from dev.db, split in two: titles where `UX` stands as
// its own word, and titles where `ux` only appears inside another word —
// Luxembourg, Luxury, Benelux, BeLux, UxS. The second group is what substring
// matching used to wrongly admit.
const uxAsWord = fixture.ux_as_word;
const uxInsideAWord = fixture.ux_inside_a_word;

describe("AC 40: the search term UX matches only titles where UX stands as its own word", () => {
  // An emptied or broken fixture would let both tests below pass without
  // checking anything, so both groups have to actually hold titles.
  test("the fixture holds titles in both groups", () => {
    expect(uxAsWord.length).toBeGreaterThan(0);
    expect(uxInsideAWord.length).toBeGreaterThan(0);
  });

  test("every title holding UX as its own word matches the term UX", () => {
    const missed = uxAsWord.filter((title) => !matchesSearchTerms(title, ["UX"]));
    // Collecting the offending titles rather than counting them means a
    // failure names what went wrong instead of leaving it to be re-derived.
    expect(missed).toEqual([]);
  });

  test("no title holding ux only inside another word matches the term UX", () => {
    const wronglyMatched = uxInsideAWord.filter((title) => matchesSearchTerms(title, ["UX"]));
    expect(wronglyMatched).toEqual([]);
  });
});

describe("AC 41: an accented word is one token, not split at the accent", () => {
  test("two words, one accented, yield exactly those two tokens", () => {
    // Splitting on anything outside a-z0-9 would treat `é` as a separator and
    // break `Ingénieur` into `ing` and `nieur`. Neither word changes under the
    // stemmer, so the tokens can be asserted exactly.
    expect(analyze("Ingénieur Produit")).toEqual(["ingénieur", "produit"]);
  });

  test("no fragment from before the accent appears on its own", () => {
    expect(analyze("Ingénieur Produit")).not.toContain("ing");
  });

  test("a term holding an accented word matches a title holding it", () => {
    expect(matchesSearchTerms("Ingénieur Produit Senior", ["Ingénieur Produit"])).toBe(true);
  });
});

describe("AC 42: the term Product Design matches Senior Product Designer through stemming", () => {
  test("the term matches, because designer stems to design", () => {
    expect(matchesSearchTerms("Senior Product Designer", ["Product Design"])).toBe(true);
  });

  test("a title holding only part of the term does not match", () => {
    // A term matches only when every one of its words is present, so half a
    // term is not a match.
    expect(matchesSearchTerms("Senior Graphic Designer", ["Product Design"])).toBe(false);
  });
});

describe("AC 43: a token of three characters or fewer is not stemmed", () => {
  test("a three-character token the stemmer would shorten stays whole", () => {
    // Measured, the stemmer turns `uxs` into `ux`. Were three-character tokens
    // stemmed, every real `UxS ...` title would collapse onto the search term
    // `UX` and match it wrongly, which is the group AC 40 guards. So the
    // exemption reaches three characters, not only one and two.
    expect(analyze("UxS")).toEqual(["uxs"]);
  });

  test("a four-character token is still stemmed", () => {
    // The guard exempts short tokens without switching stemming off, so the
    // first length the stemmer sees is four.
    expect(analyze("Designs")).toEqual(["design"]);
  });
});

describe("AC 77: a blank search term matches nothing", () => {
  test("a term holding no words matches no title", () => {
    // A blank term analyzes to no words at all, and "every word present" is
    // vacuously true of no words, so without a guard one stray blank term in
    // settings would quietly match every job collected.
    expect(matchesSearchTerms("Senior Graphic Designer", [""])).toBe(false);
  });

  test("a term of only punctuation matches no title", () => {
    expect(matchesSearchTerms("Senior Graphic Designer", ["   -  "])).toBe(false);
  });

  test("a real term beside a blank one still matches", () => {
    expect(matchesSearchTerms("Senior Product Designer", ["", "Product Design"])).toBe(true);
  });

  test("an empty term list matches no title", () => {
    expect(matchesSearchTerms("Senior Product Designer", [])).toBe(false);
  });
});

describe("AC 44: a search term matches without being special-cased", () => {
  test("an invented two-word term matches a title holding it", () => {
    // `Glorbnak Quixotry` is invented for this test and appears nowhere else
    // in the codebase, so a match can only come from the general algorithm.
    expect(matchesSearchTerms("Senior Glorbnak Quixotry Lead", ["Glorbnak Quixotry"])).toBe(true);
  });
});
