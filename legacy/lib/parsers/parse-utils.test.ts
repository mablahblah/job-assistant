import { describe, it, expect } from "vitest";
import { extractJsonLd, stripHtml } from "./parse-utils";

describe("extractJsonLd", () => {
  it("extracts JobPosting from a standard JSON-LD script tag", () => {
    const html = `
      <html><head>
        <script type="application/ld+json">
          {"@type": "JobPosting", "title": "Product Designer", "hiringOrganization": {"name": "Acme"}}
        </script>
      </head></html>
    `;
    const result = extractJsonLd(html);
    expect(result.title).toBe("Product Designer");
    expect(result.hiringOrganization?.name).toBe("Acme");
  });

  it("extracts JobPosting from an @graph array", () => {
    const html = `
      <html><head>
        <script type="application/ld+json">
          {"@graph": [{"@type": "Organization", "name": "Acme"}, {"@type": "JobPosting", "title": "Designer"}]}
        </script>
      </head></html>
    `;
    expect(extractJsonLd(html).title).toBe("Designer");
  });

  it("returns empty object when no JSON-LD is present", () => {
    const html = `<html><body><h1>No structured data</h1></body></html>`;
    expect(extractJsonLd(html)).toEqual({});
  });

  it("skips malformed JSON and finds valid JSON-LD after it", () => {
    const html = `
      <html><head>
        <script type="application/ld+json">{broken json here</script>
        <script type="application/ld+json">{"@type": "JobPosting", "title": "Valid"}</script>
      </head></html>
    `;
    expect(extractJsonLd(html).title).toBe("Valid");
  });

  it("skips non-JobPosting JSON-LD types", () => {
    const html = `
      <html><head>
        <script type="application/ld+json">{"@type": "Organization", "name": "Acme"}</script>
      </head></html>
    `;
    expect(extractJsonLd(html)).toEqual({});
  });

  it("extracts salary and location from JSON-LD", () => {
    const html = `
      <html><head>
        <script type="application/ld+json">{
          "@type": "JobPosting",
          "baseSalary": {"value": {"minValue": 120000, "maxValue": 180000}},
          "jobLocation": {"address": {"addressLocality": "Austin", "addressRegion": "TX"}}
        }</script>
      </head></html>
    `;
    const result = extractJsonLd(html);
    expect(result.baseSalary?.value?.minValue).toBe(120000);
    expect(result.jobLocation?.address?.addressLocality).toBe("Austin");
  });
});

describe("stripHtml", () => {
  it("removes tags and trims whitespace", () => {
    expect(stripHtml("<h1>  Product Designer  </h1>")).toBe("Product Designer");
  });

  it("collapses multiple spaces", () => {
    expect(stripHtml("<p>Senior  Product  Designer</p>")).toBe("Senior Product Designer");
  });
});
