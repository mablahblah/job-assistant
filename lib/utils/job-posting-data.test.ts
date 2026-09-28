import { describe, expect, test } from "vitest";
import { jobFieldsFromJobPosting, jobPostingFromHtml } from "./job-posting-data";

// A page carrying the given search-engine data blocks, each in its own tag.
function pageWith(...blocks: string[]): string {
  const tags = blocks.map((block) => `<script type="application/ld+json">${block}</script>`).join("");
  return `<html><head>${tags}</head><body><p>A page</p></body></html>`;
}

const POSTING = { "@context": "https://schema.org", "@type": "JobPosting", title: "Product Designer" };

describe("jobPostingFromHtml: a page's job data is found", () => {
  test("a page's job data block comes back", () => {
    expect(jobPostingFromHtml(pageWith(JSON.stringify(POSTING)))).toMatchObject({ title: "Product Designer" });
  });

  test("the job data is found among other blocks", () => {
    const breadcrumbs = JSON.stringify({ "@type": "BreadcrumbList", itemListElement: [] });
    expect(jobPostingFromHtml(pageWith(breadcrumbs, JSON.stringify(POSTING)))).toMatchObject({
      title: "Product Designer",
    });
  });

  test("the job data is found inside a list of blocks", () => {
    const list = JSON.stringify([{ "@type": "Organization", name: "Acme" }, POSTING]);
    expect(jobPostingFromHtml(pageWith(list))).toMatchObject({ title: "Product Designer" });
  });

  test("the job data is found inside a graph of blocks", () => {
    const graph = JSON.stringify({ "@context": "https://schema.org", "@graph": [{ "@type": "WebPage" }, POSTING] });
    expect(jobPostingFromHtml(pageWith(graph))).toMatchObject({ title: "Product Designer" });
  });

  test("a page with no job data answers nothing", () => {
    expect(jobPostingFromHtml("<html><body><p>No data</p></body></html>")).toBeNull();
  });

  test("a page whose only block is not a job answers nothing", () => {
    expect(jobPostingFromHtml(pageWith(JSON.stringify({ "@type": "Organization", name: "Acme" })))).toBeNull();
  });

  test("a block that is not valid data is skipped rather than thrown over", () => {
    expect(jobPostingFromHtml(pageWith("{not json", JSON.stringify(POSTING)))).toMatchObject({
      title: "Product Designer",
    });
  });
});

describe("jobFieldsFromJobPosting: the five details are read", () => {
  test("the posted date is read", () => {
    expect(jobFieldsFromJobPosting({ datePosted: "2026-08-28" }).posting_date?.toISOString()).toBe(
      "2026-08-28T00:00:00.000Z"
    );
  });

  test("the updated date is read", () => {
    expect(jobFieldsFromJobPosting({ dateModified: "2026-08-30" }).posting_updated_date?.toISOString()).toBe(
      "2026-08-30T00:00:00.000Z"
    );
  });

  test("a date that cannot be read is left out", () => {
    const fields = jobFieldsFromJobPosting({ datePosted: "soon", dateModified: "TBD" });
    expect(fields).not.toHaveProperty("posting_date");
    expect(fields).not.toHaveProperty("posting_updated_date");
  });

  test("a job for remote workers is read as remote", () => {
    expect(jobFieldsFromJobPosting({ jobLocationType: "TELECOMMUTE" }).raw_mode_list).toEqual(["remote"]);
  });

  test("a job naming no way of working has no work mode", () => {
    expect(jobFieldsFromJobPosting({}).raw_mode_list ?? []).toEqual([]);
  });

  test("an address becomes one place", () => {
    const posting = {
      jobLocation: {
        "@type": "Place",
        address: { addressLocality: "Austin", addressRegion: "TX", addressCountry: "US" },
      },
    };
    expect(jobFieldsFromJobPosting(posting).raw_location_list).toEqual(["Austin, TX, US"]);
  });

  test("every address in a list becomes a place", () => {
    const posting = {
      jobLocation: [
        { address: { addressLocality: "Austin", addressRegion: "TX" } },
        { address: { addressLocality: "Denver", addressRegion: "CO" } },
      ],
    };
    expect(jobFieldsFromJobPosting(posting).raw_location_list).toEqual(["Austin, TX", "Denver, CO"]);
  });

  test("an address written as one line is kept as it is", () => {
    expect(jobFieldsFromJobPosting({ jobLocation: { address: "Austin, TX" } }).raw_location_list).toEqual([
      "Austin, TX",
    ]);
  });

  test("a country named as an object is read by its name", () => {
    const posting = { jobLocation: { address: { addressCountry: { "@type": "Country", name: "Canada" } } } };
    expect(jobFieldsFromJobPosting(posting).raw_location_list).toEqual(["Canada"]);
  });

  test("a remote job's allowed countries are its places", () => {
    const posting = {
      applicantLocationRequirements: [
        { "@type": "Country", name: "United States" },
        { "@type": "Country", name: "Canada" },
      ],
    };
    expect(jobFieldsFromJobPosting(posting).raw_location_list).toEqual(["United States", "Canada"]);
  });

  test("a single allowed country is a place", () => {
    const posting = { applicantLocationRequirements: { "@type": "Country", name: "Mexico" } };
    expect(jobFieldsFromJobPosting(posting).raw_location_list).toEqual(["Mexico"]);
  });

  test("a job naming no place has no places", () => {
    expect(jobFieldsFromJobPosting({}).raw_location_list ?? []).toEqual([]);
  });

  test("the description is read", () => {
    expect(jobFieldsFromJobPosting({ description: "<p>Design things.</p>" }).description).toBe(
      "<p>Design things.</p>"
    );
  });

  test("title, employer and pay are not read", () => {
    const fields = jobFieldsFromJobPosting({
      title: "Designer",
      hiringOrganization: { name: "Acme" },
      baseSalary: { currency: "USD", value: { minValue: 1, maxValue: 2 } },
    });
    expect(fields).not.toHaveProperty("raw_title");
    expect(fields).not.toHaveProperty("raw_company_name");
    expect(fields).not.toHaveProperty("raw_salary");
  });
});
