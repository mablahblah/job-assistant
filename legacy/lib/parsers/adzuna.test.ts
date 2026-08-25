import { describe, it, expect } from "vitest";
import { parseAdzunaJob } from "./adzuna";
import type { Browser } from "playwright";
import type { CollectedJob } from "../collectors/types";

describe("parseAdzunaJob", () => {
  // Pass-through parser needs no browser — stub it
  const fakeBrowser = {} as Browser;

  it("returns success with empty fields (pass-through)", async () => {
    const collectorData: CollectedJob = {
      url: "https://www.adzuna.com/details/12345",
      source: "adzuna",
      title: "Product Designer",
      companyName: "Acme Corp",
      location: "Austin, TX",
      workMode: "remote",
      dates: [new Date("2026-04-20")],
      salaryRange: "$120-160k",
    };

    const result = await parseAdzunaJob(
      "https://www.adzuna.com/details/12345",
      fakeBrowser,
      collectorData,
    );

    expect(result.success).toBe(true);
    expect(result.parser).toBe("adzuna");
    expect(result.fields).toEqual({});
    expect(result.failedFields).toEqual([]);
    expect(result.url).toBe("https://www.adzuna.com/details/12345");
    expect(result.finalUrl).toBe("https://www.adzuna.com/details/12345");
  });

  it("returns success even without collector data", async () => {
    const result = await parseAdzunaJob(
      "https://www.adzuna.com/details/99999",
      fakeBrowser,
    );

    expect(result.success).toBe(true);
    expect(result.fields).toEqual({});
  });
});
