import { describe, it, expect } from "vitest";
import { parseAshbyHtml } from "./ashby";
import type { AshbyAppData } from "./ashby";

const emptyHtml = "<html><body></body></html>";

describe("parseAshbyHtml", () => {
  // -- Title --

  it("prefers title from appData", () => {
    const html = `<html><head>
      <script type="application/ld+json">{"@type": "JobPosting", "title": "JSON-LD Title"}</script>
    </head></html>`;
    const appData: AshbyAppData = { title: "AppData Title" };
    expect(parseAshbyHtml(html, appData).title).toBe("AppData Title");
  });

  it("falls back to JSON-LD title when no appData", () => {
    const html = `<html><head>
      <script type="application/ld+json">{"@type": "JobPosting", "title": "Senior Product Designer"}</script>
    </head></html>`;
    expect(parseAshbyHtml(html).title).toBe("Senior Product Designer");
  });

  it("falls back to h1 when no appData or JSON-LD title", () => {
    expect(parseAshbyHtml("<html><body><h1>Staff Designer</h1></body></html>").title).toBe("Staff Designer");
  });

  // -- Company --

  it("extracts company from JSON-LD (not in appData)", () => {
    const html = `<html><head>
      <script type="application/ld+json">{"@type": "JobPosting", "hiringOrganization": {"name": "Notion"}}</script>
    </head></html>`;
    expect(parseAshbyHtml(html).companyName).toBe("Notion");
  });

  // -- Work mode --

  it("uses appData workplaceType for work mode", () => {
    expect(parseAshbyHtml(emptyHtml, { workplaceType: "Hybrid" }).workMode).toBe("hybrid");
    expect(parseAshbyHtml(emptyHtml, { workplaceType: "Remote" }).workMode).toBe("remote");
    expect(parseAshbyHtml(emptyHtml, { workplaceType: "On-Site" }).workMode).toBe("in-person");
  });

  it("defaults to in-person when workplaceType is null but location exists", () => {
    expect(parseAshbyHtml(emptyHtml, { locationName: "London" }).workMode).toBe("in-person");
  });

  it("does not set work mode when no appData at all", () => {
    expect(parseAshbyHtml(emptyHtml).workMode).toBeUndefined();
  });

  // -- Location --

  it("combines primary + secondary locations from appData", () => {
    const appData: AshbyAppData = {
      locationName: "Denver",
      secondaryLocationNames: ["Toronto", "San Francisco"],
    };
    expect(parseAshbyHtml(emptyHtml, appData).location).toBe("Denver, Toronto, San Francisco");
  });

  it("uses only primary location when no secondary", () => {
    const appData: AshbyAppData = { locationName: "Seattle HQ" };
    expect(parseAshbyHtml(emptyHtml, appData).location).toBe("Seattle HQ");
  });

  it("falls back to JSON-LD location when no appData", () => {
    const html = `<html><head>
      <script type="application/ld+json">
        {"@type": "JobPosting", "jobLocation": {"address": {"addressLocality": "San Francisco", "addressRegion": "CA"}}}
      </script>
    </head></html>`;
    expect(parseAshbyHtml(html).location).toBe("San Francisco, CA");
  });

  it("deduplicates JSON-LD location when region equals country", () => {
    const html = `<html><head>
      <script type="application/ld+json">
        {"@type": "JobPosting", "jobLocation": {"address": {"addressLocality": "London", "addressRegion": "United Kingdom", "addressCountry": "United Kingdom"}}}
      </script>
    </head></html>`;
    expect(parseAshbyHtml(html).location).toBe("London, United Kingdom");
  });

  // -- Posted date --

  it("prefers publishedDate from appData", () => {
    const html = `<html><head>
      <script type="application/ld+json">{"@type": "JobPosting", "datePosted": "2026-04-10"}</script>
    </head></html>`;
    const appData: AshbyAppData = { publishedDate: "2026-04-15" };
    expect(parseAshbyHtml(html, appData).dates).toContain("2026-04-15");
  });

  it("falls back to JSON-LD datePosted", () => {
    const html = `<html><head>
      <script type="application/ld+json">{"@type": "JobPosting", "datePosted": "2026-04-15"}</script>
    </head></html>`;
    expect(parseAshbyHtml(html).dates).toContain("2026-04-15");
  });

  // -- Salary --

  it("extracts salary from JSON-LD baseSalary", () => {
    const html = `<html><head>
      <script type="application/ld+json">
        {"@type": "JobPosting", "baseSalary": {"value": {"minValue": 150000, "maxValue": 200000}}}
      </script>
    </head></html>`;
    expect(parseAshbyHtml(html).salaryRange).toBe("$150-200k");
  });

  it("falls back to appData compensationTierSummary", () => {
    const appData: AshbyAppData = { compensationTierSummary: "$126.5K – $169K • Offers Equity" };
    expect(parseAshbyHtml(emptyHtml, appData).salaryRange).toBe("$127-169k");
  });

  it("falls back to page text for salary", () => {
    const html = "<html><body><p>Compensation: $120,000 - $160,000 annually</p></body></html>";
    expect(parseAshbyHtml(html).salaryRange).toBe("$120-160k");
  });

  // -- Empty page --

  it("returns empty fields for pages with no extractable data", () => {
    const result = parseAshbyHtml(emptyHtml);
    expect(result.title).toBeUndefined();
    expect(result.companyName).toBeUndefined();
    expect(result.salaryRange).toBeUndefined();
  });
});
