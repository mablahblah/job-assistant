import { describe, expect, test } from "vitest";
import { doubtsFromContact } from "./enrichment-doubts";

const FULL = {
  address: "760 Market Street, San Francisco, CA 94102",
  phone: "415-555-0142",
  website: "https://www.figma.com",
};

// Criterion 61. A search that answered fully raises nothing, so the user is
// shown a warning only where there is something to check.
describe("a search that filled everything in", () => {
  test("raises no doubt", () => {
    expect(doubtsFromContact(FULL)).toEqual([]);
  });

  test("a missing website alone raises no doubt", () => {
    expect(doubtsFromContact({ address: FULL.address, phone: FULL.phone })).toEqual([]);
  });
});

// Criterion 59. The filing is a Texas one, so an address the reader took from
// a result about a foreign office is worth a second look before it is filed.
describe("an address that does not read as a United States one", () => {
  test.each([
    "12 Rue de Rivoli, 75001 Paris, France",
    "1 Hacker Way, London",
  ])("%j is doubted", (address) => {
    expect(doubtsFromContact({ address, phone: FULL.phone })).toEqual(["address_outside_us"]);
  });

  test.each([
    "760 Market Street, San Francisco, CA 94102",
    "12 High Street, Springfield, United States",
  ])("%j is not doubted", (address) => {
    expect(doubtsFromContact({ address, phone: FULL.phone })).toEqual([]);
  });
});

// Criterion 60. The address is the field the form most needs, so its absence
// is stated rather than left as an empty box the user discovers at filing.
describe("a search that filled in no address", () => {
  test.each([undefined, "", "   "])("an address of %p is doubted", (address) => {
    expect(doubtsFromContact({ address, phone: FULL.phone })).toEqual(["missing_address"]);
  });
});

// Criterion 82.
describe("a search that filled in no phone number", () => {
  test.each([undefined, "", "   "])("a phone of %p is doubted", (phone) => {
    expect(doubtsFromContact({ address: FULL.address, phone })).toEqual(["missing_phone"]);
  });
});

// Two of six employers measured against the live service yielded nothing at
// all, so both doubts firing together is an ordinary outcome rather than an
// edge case.
describe("a search that filled in neither", () => {
  test("raises both doubts", () => {
    expect(doubtsFromContact({})).toEqual(["missing_address", "missing_phone"]);
  });
});

// A foreign address is still an address, so it cannot be doubted for being
// absent as well.
describe("a foreign address with no phone number", () => {
  test("raises the foreign doubt and the missing phone doubt", () => {
    expect(doubtsFromContact({ address: "1 Hacker Way, London" })).toEqual([
      "address_outside_us",
      "missing_phone",
    ]);
  });
});
