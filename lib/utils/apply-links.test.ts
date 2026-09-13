import { describe, expect, test } from "vitest";
import { filterApplyLinks } from "./apply-links";

describe("filterApplyLinks: apply wording is kept", () => {
  test("Apply Now is an apply link", () => {
    const links = [{ href: "https://example.com/apply", text: "Apply Now" }];
    expect(filterApplyLinks(links)).toEqual(links);
  });

  test("Apply on its own is an apply link", () => {
    const links = [{ href: "https://example.com/apply", text: "Apply" }];
    expect(filterApplyLinks(links)).toEqual(links);
  });

  test("the wording is read whatever its case", () => {
    const links = [{ href: "https://example.com/apply", text: "APPLY NOW" }];
    expect(filterApplyLinks(links)).toEqual(links);
  });
});

describe("filterApplyLinks: wording that points at the original posting is kept", () => {
  test("View Original is an apply link", () => {
    const links = [{ href: "https://example.com/job", text: "View Original" }];
    expect(filterApplyLinks(links)).toEqual(links);
  });

  test("View Job is an apply link", () => {
    const links = [{ href: "https://example.com/job", text: "View Job" }];
    expect(filterApplyLinks(links)).toEqual(links);
  });
});

describe("filterApplyLinks: everything else is dropped", () => {
  test("links whose wording says nothing about applying are dropped", () => {
    const links = [
      { href: "https://example.com/save", text: "Save" },
      { href: "https://example.com/share", text: "Share" },
      { href: "https://example.com/about", text: "Learn More" },
    ];
    expect(filterApplyLinks(links)).toEqual([]);
  });

  test("a mixed list keeps only the apply links, in the order given", () => {
    const links = [
      { href: "https://example.com/about", text: "About Us" },
      { href: "https://greenhouse.io/apply", text: "Apply Now" },
      { href: "https://example.com/share", text: "Share Job" },
      { href: "https://lever.co/job/123", text: "View Job Posting" },
    ];
    expect(filterApplyLinks(links)).toEqual([
      { href: "https://greenhouse.io/apply", text: "Apply Now" },
      { href: "https://lever.co/job/123", text: "View Job Posting" },
    ]);
  });
});
