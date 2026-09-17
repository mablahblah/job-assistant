import { describe, expect, test } from "vitest";
import { contactFromText } from "./enrichment-contact";

// Criterion 45. The address goes on a Texas Workforce Commission filing, so a
// shape the reader misses costs the user a blank field on a legal form. The
// spelled-out street words below were measured as missed by the old reader
// and are the reason this one is wider than the code it ports.
describe("the address a result's text holds", () => {
  test.each([
    ["Headquarters: 760 Market Street, San Francisco, CA 94102", "760 Market Street, San Francisco, CA 94102"],
    ["Headquarters: 760 Market St, San Francisco, CA 94102", "760 Market St, San Francisco, CA 94102"],
    ["Address: 760 Market Street San Francisco CA 94102", "760 Market Street San Francisco CA 94102"],
    ["Located at 633 Folsom St, San Francisco, CA 94107. Call us.", "633 Folsom St, San Francisco, CA 94107"],
    ["5900 Penn Ave, Pittsburgh, PA 15206", "5900 Penn Ave, Pittsburgh, PA 15206"],
    ["1600 Amphitheatre Parkway, Mountain View, CA 94043", "1600 Amphitheatre Parkway, Mountain View, CA 94043"],
    ["1550 Bryant Street, Suite 200, San Francisco, CA 94103", "1550 Bryant Street, Suite 200, San Francisco, CA 94103"],
  ])("reads %j", (text, address) => {
    expect(contactFromText(text).address).toBe(address);
  });

  test.each([
    "Figma is a design tool used by millions of people worldwide.",
    "Founded in 2012 with 500 employees and revenue of 100 million",
    "",
  ])("finds no address in %j", (text) => {
    expect(contactFromText(text).address).toBeUndefined();
  });
});

// Criterion 46.
describe("the phone number a result's text holds", () => {
  test.each([
    ["Call us at (415) 555-0142 for details", "(415) 555-0142"],
    ["Phone: 415-555-0142", "415-555-0142"],
    ["Phone: 415.555.0142", "415.555.0142"],
    ["Reach us on 415 555 0142 any weekday", "415 555 0142"],
  ])("reads %j", (text, phone) => {
    expect(contactFromText(text).phone).toBe(phone);
  });

  test("finds no phone number where there is none", () => {
    expect(contactFromText("Figma is a design tool.").phone).toBeUndefined();
  });
});

// Criterion 47. A bare domain is given a scheme, because the value is shown
// as a link and a link with no scheme is read as a path on our own site.
describe("the website a result's text holds", () => {
  test("reads a labelled bare domain and gives it a scheme", () => {
    expect(contactFromText("Website: www.figma.com").website).toBe("https://www.figma.com");
  });

  test("reads a labelled full address unchanged", () => {
    expect(contactFromText("Website: https://figma.com").website).toBe("https://figma.com");
  });

  test("finds no website where no label names one", () => {
    expect(contactFromText("Figma is used at figma.com by millions.").website).toBeUndefined();
  });
});

// Every field is read out of the same result, so one text can answer all
// three, some of them, or none.
describe("one result's text answering more than one field", () => {
  test("reads all three from one text", () => {
    const found = contactFromText(
      "Headquarters: 760 Market Street, San Francisco, CA 94102. Phone: 415-555-0142. Website: www.figma.com"
    );

    expect(found).toEqual({
      address: "760 Market Street, San Francisco, CA 94102",
      phone: "415-555-0142",
      website: "https://www.figma.com",
    });
  });

  test("a text holding nothing answers with an empty object", () => {
    expect(contactFromText("Figma is a design tool.")).toEqual({});
  });
});
