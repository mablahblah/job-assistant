import { describe, expect, test } from "vitest";
import { descriptionToText } from "./description-text";

describe("Greenhouse's markup is decoded once, then read", () => {
  test("an entity-encoded description decodes to markup whose own entities then resolve", () => {
    // Greenhouse sends HTML that has itself been entity-encoded one time, so
    // one decode returns real tags and &amp;mdash; only becomes a dash once
    // that markup is parsed.
    const raw =
      "&lt;div class=&quot;pay-range&quot;&gt;&lt;span&gt;$139,200&lt;/span&gt;&lt;span&gt;&amp;mdash;&lt;/span&gt;&lt;span&gt;$235,200 USD&lt;/span&gt;&lt;/div&gt;";
    expect(descriptionToText(raw)).toBe("$139,200—$235,200 USD");
  });
});

describe("plain text from Lever and Ashby passes through unharmed", () => {
  test("a Lever descriptionPlain string comes back as it went in", () => {
    const plain = "We are looking for a Senior Product Designer to join our team.";
    expect(descriptionToText(plain)).toBe(plain);
  });

  test("an Ashby plain-text string comes back as it went in", () => {
    const plain = "This role is fully remote for candidates based in the United States.";
    expect(descriptionToText(plain)).toBe(plain);
  });
});

describe("a description carrying its own body tag is not lost", () => {
  test("real text comes back rather than an empty string", () => {
    // linkedom hands back an empty body for a fragment that opens with a
    // literal <body> tag, so every description is wrapped in a full
    // <html><body> document before it is parsed.
    expect(descriptionToText("<body><p>Design beautiful products.</p></body>")).toBe(
      "Design beautiful products."
    );
  });
});

describe("tags are removed and their text is kept", () => {
  test("a heading, a paragraph and an inline tag all keep their words", () => {
    const html = "<h2>About the role</h2><p>Design <strong>beautiful</strong> products.</p>";
    // One block is kept apart from the next, so a sentence opening a block is
    // still found. An inline tag gets no such space, which is what keeps a
    // figure split across two of them in one piece.
    expect(descriptionToText(html)).toBe("About the role Design beautiful products.");
  });

  test("a list keeps every item's words and none of its markup", () => {
    const text = descriptionToText("<ul><li>Design</li><li>Ship</li></ul>");
    expect(text).not.toContain("<");
    expect(text).toContain("Design");
    expect(text).toContain("Ship");
  });
});

describe("runs of whitespace collapse to a single space", () => {
  test("newlines, tabs and repeated spaces each become one space", () => {
    expect(descriptionToText("Line one.\n\n\tLine   two.")).toBe("Line one. Line two.");
  });

  test("whitespace inside markup collapses the same way", () => {
    expect(descriptionToText("<p>Line   one.</p>\n<p>Line\ttwo.</p>")).toBe("Line one. Line two.");
  });
});
