import { describe, expect, test } from "vitest";
import { nameFromSlug } from "./ats-slug-name";

describe("nameFromSlug", () => {
  test("a hyphen separates words into a space-joined name", () => {
    expect(nameFromSlug("hinge-health")).toBe("Hinge Health");
  });

  test("a single word gets its first letter capitalized", () => {
    expect(nameFromSlug("modernhealth")).toBe("Modernhealth");
  });

  test("capitals already in the slug are kept", () => {
    // Lowercasing the rest would turn USMobile into Usmobile.
    expect(nameFromSlug("USMobile")).toBe("USMobile");
  });

  test("an underscore separates words the same way a hyphen does", () => {
    expect(nameFromSlug("foo_bar")).toBe("Foo Bar");
  });

  test("an empty slug gives an empty string", () => {
    expect(nameFromSlug("")).toBe("");
  });
});
