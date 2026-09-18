import { describe, expect, test } from "vitest";
import { queryFromCompany } from "./enrichment-query";

// Criterion 83. A common employer name finds the wrong business on its own,
// so the place the job's location matched narrows the search.
describe("a job whose location matched a place", () => {
  test("the query holds the employer and that place", () => {
    expect(queryFromCompany("Figma", "San Francisco, CA")).toBe(
      "Figma San Francisco, CA headquarters address, phone number, domain url"
    );
  });
});

// Criterion 84. A job moved straight out of the backlog was never classified,
// so it carries no matched place and the name has to stand alone.
describe("a job whose location matched no place", () => {
  test.each([undefined, null, "", "   "])("a place of %p leaves the name alone", (place) => {
    expect(queryFromCompany("Figma", place)).toBe(
      "Figma headquarters address, phone number, domain url"
    );
  });

  test("the place can be left off entirely", () => {
    expect(queryFromCompany("Figma")).toBe(
      "Figma headquarters address, phone number, domain url"
    );
  });
});

// The query is sent to a paid service, so blanks around either value are
// taken off rather than paid for.
describe("values padded with blanks", () => {
  test("are trimmed before the query is built", () => {
    expect(queryFromCompany("  Figma  ", "  Austin, TX  ")).toBe(
      "Figma Austin, TX headquarters address, phone number, domain url"
    );
  });
});
