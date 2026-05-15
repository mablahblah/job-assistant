import { describe, it, expect, vi } from "vitest";

// Mock fetchWithTimeout — MUST be before dribbble import (vi.mock is hoisted)
vi.mock("../scrapers/fetch-utils", async () => {
  const actual = await vi.importActual<typeof import("../scrapers/fetch-utils")>("../scrapers/fetch-utils");
  return {
    ...actual,
    fetchWithTimeout: vi.fn(),
  };
});

import { parseDribbbleHtml, parseDribbbleJob } from "./dribbble";
import { fetchWithTimeout } from "../scrapers/fetch-utils";
import type { Browser } from "playwright";

const mockFetch = vi.mocked(fetchWithTimeout);

// Minimal fixture: inline script with tracking data + JSON-LD
const fixtureHtml = `<html><head>
  <script type="application/ld+json">{
    "@type": "JobPosting",
    "title": "Senior Product Designer",
    "datePosted": "2026-04-15T10:00:00-04:00",
    "hiringOrganization": {"name": "Acme Corp"},
    "jobLocation": {"address": {"addressLocality": "Austin", "addressRegion": "Texas", "addressCountry": "United States"}},
    "description": "<p>Great role</p>"
  }</script>
</head><body>
  <script>
    Dribbble.JobListing.initialize({
      locationType: "onsite_or_remote",
      trackingProperties: {
        job_title: "Senior Product Designer",
        job_company: "Acme Corp",
        job_id: "12345",
        job_location: "Austin, TX",
        job_location_country: "US",
        job_location_state: "TX",
        job_role_type: "full-time"
      }
    })
  </script>
</body></html>`;

const emptyHtml = "<html><body></body></html>";

describe("parseDribbbleHtml", () => {
  it("extracts title from app data", () => {
    expect(parseDribbbleHtml(fixtureHtml).title).toBe("Senior Product Designer");
  });

  it("extracts company from app data", () => {
    expect(parseDribbbleHtml(fixtureHtml).companyName).toBe("Acme Corp");
  });

  // -- Work mode --

  it("maps 'remote' locationType to remote", () => {
    const html = `<html><body><script>
      Dribbble.JobListing.initialize({
        locationType: "remote",
        trackingProperties: { job_title: "D" }
      })
    </script></body></html>`;
    expect(parseDribbbleHtml(html).workMode).toBe("remote");
  });

  it("maps 'remote_only' locationType to remote", () => {
    const html = `<html><body><script>
      Dribbble.JobListing.initialize({
        locationType: "remote_only",
        trackingProperties: { job_title: "D" }
      })
    </script></body></html>`;
    expect(parseDribbbleHtml(html).workMode).toBe("remote");
  });

  it("maps 'onsite_or_remote' locationType to hybrid", () => {
    expect(parseDribbbleHtml(fixtureHtml).workMode).toBe("hybrid");
  });

  it("maps 'onsite_only' locationType to in-person", () => {
    const html = `<html><body><script>
      Dribbble.JobListing.initialize({
        locationType: "onsite_only",
        trackingProperties: { job_title: "D" }
      })
    </script></body></html>`;
    expect(parseDribbbleHtml(html).workMode).toBe("in-person");
  });

  it("returns empty workMode when locationType is missing", () => {
    const html = `<html><body><script>
      Dribbble.JobListing.initialize({
        trackingProperties: { job_title: "D" }
      })
    </script></body></html>`;
    expect(parseDribbbleHtml(html).workMode).toBe("");
  });

  it("returns empty workMode when no app data at all", () => {
    expect(parseDribbbleHtml(emptyHtml).workMode).toBeUndefined();
  });

  // -- Location --

  it("combines and deduplicates location fragments from app data and JSON-LD", () => {
    // fixtureHtml has app data: "Austin, TX", "US", "TX"
    // and JSON-LD: "Austin", "Texas", "United States"
    const result = parseDribbbleHtml(fixtureHtml);
    expect(result.location).toContain("Austin");
    expect(result.location).toContain("TX");
    expect(result.location).toContain("US");
    expect(result.location).toContain("Texas");
    expect(result.location).toContain("United States");
    // Should not duplicate "Austin" (appears in both sources)
    const parts = result.location!.split(", ");
    const unique = new Set(parts);
    expect(parts.length).toBe(unique.size);
  });

  it("uses JSON-LD location when no app data", () => {
    const html = `<html><head>
      <script type="application/ld+json">{
        "@type": "JobPosting",
        "jobLocation": {"address": {"addressLocality": "Berlin", "addressRegion": "Germany", "addressCountry": "Germany"}}
      }</script>
    </head></html>`;
    expect(parseDribbbleHtml(html).location).toBe("Berlin, Germany");
  });

  it("handles remote jobs with no location details", () => {
    const html = `<html><body><script>
      Dribbble.JobListing.initialize({
        locationType: "remote",
        trackingProperties: { job_title: "D", job_location: "Remote" }
      })
    </script></body></html>`;
    expect(parseDribbbleHtml(html).location).toBe("Remote");
  });

  // -- Posted date --

  it("extracts date from JSON-LD datePosted (first 10 chars)", () => {
    expect(parseDribbbleHtml(fixtureHtml).postedAt).toBe("2026-04-15");
  });

  it("handles date-only datePosted without time component", () => {
    const html = `<html><head>
      <script type="application/ld+json">{
        "@type": "JobPosting",
        "datePosted": "2026-03-01"
      }</script>
    </head></html>`;
    expect(parseDribbbleHtml(html).postedAt).toBe("2026-03-01");
  });

  // -- Salary --

  it("extracts salary from JSON-LD description text", () => {
    const html = `<html><head>
      <script type="application/ld+json">{
        "@type": "JobPosting",
        "description": "<p>Compensation: $120,000 - $160,000 annually</p>"
      }</script>
    </head></html>`;
    expect(parseDribbbleHtml(html).salaryRange).toBe("$120-160k");
  });

  it("returns undefined salaryRange when no salary in description", () => {
    expect(parseDribbbleHtml(fixtureHtml).salaryRange).toBeUndefined();
  });

  // -- Fallbacks to JSON-LD --

  it("falls back to JSON-LD title when no app data", () => {
    const html = `<html><head>
      <script type="application/ld+json">{
        "@type": "JobPosting",
        "title": "Design Lead"
      }</script>
    </head></html>`;
    expect(parseDribbbleHtml(html).title).toBe("Design Lead");
  });

  it("falls back to JSON-LD company when no app data", () => {
    const html = `<html><head>
      <script type="application/ld+json">{
        "@type": "JobPosting",
        "hiringOrganization": {"name": "FallbackCo"}
      }</script>
    </head></html>`;
    expect(parseDribbbleHtml(html).companyName).toBe("FallbackCo");
  });

  // -- Empty page --

  it("returns empty fields for pages with no extractable data", () => {
    const result = parseDribbbleHtml(emptyHtml);
    expect(result.title).toBeUndefined();
    expect(result.companyName).toBeUndefined();
    expect(result.workMode).toBeUndefined();
    expect(result.location).toBeUndefined();
    expect(result.postedAt).toBeUndefined();
    expect(result.salaryRange).toBeUndefined();
  });
});

describe("parseDribbbleJob", () => {
  const fakeBrowser = {} as Browser;

  it("fetches HTML and returns parsed fields", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => fixtureHtml,
    } as Response);

    const result = await parseDribbbleJob(
      "https://dribbble.com/jobs/12345-Senior-Product-Designer",
      fakeBrowser,
    );

    expect(result.success).toBe(true);
    expect(result.parser).toBe("dribbble");
    expect(result.fields.title).toBe("Senior Product Designer");
    expect(result.fields.companyName).toBe("Acme Corp");
    expect(result.fields.workMode).toBe("hybrid");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://dribbble.com/jobs/12345-Senior-Product-Designer",
    );
  });

  it("returns failure when fetch returns non-200", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response);

    const result = await parseDribbbleJob(
      "https://dribbble.com/jobs/99999-Gone",
      fakeBrowser,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("404");
  });

  it("returns failure when fetch throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("timeout"));

    const result = await parseDribbbleJob(
      "https://dribbble.com/jobs/99999-Timeout",
      fakeBrowser,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("timeout");
  });
});
