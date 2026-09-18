import { describe, expect, test } from "vitest";
import { escapeHtml } from "./escape-html";

// Criterion 161. Every value on the page comes out of the database, and the
// page is built in one pass, so one unescaped quotation mark inside a tooltip
// attribute takes the rest of the row with it.
describe("escapeHtml", () => {
  test("turns an ampersand into its escape", () => {
    expect(escapeHtml("Ben & Jerry")).toBe("Ben &amp; Jerry");
  });

  test("turns angle brackets into their escapes", () => {
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
  });

  test("turns a double quotation mark into its escape", () => {
    expect(escapeHtml('the "best" role')).toBe("the &quot;best&quot; role");
  });

  test("turns a single quotation mark into its escape", () => {
    expect(escapeHtml("Land's End")).toBe("Land&#39;s End");
  });

  // The ampersand is replaced first, so an escape this function itself wrote is
  // not escaped a second time into &amp;lt;.
  test("escapes each character once", () => {
    expect(escapeHtml("a < b & c > d")).toBe("a &lt; b &amp; c &gt; d");
  });

  test("leaves text holding none of them alone", () => {
    expect(escapeHtml("Senior Product Designer")).toBe("Senior Product Designer");
  });

  // Nearly every column the page reads can be empty, and the page is built in
  // one pass, so an absent value has to come back as nothing rather than throw.
  test.each([null, undefined])("turns %s into an empty string", (value) => {
    expect(escapeHtml(value)).toBe("");
  });
});
