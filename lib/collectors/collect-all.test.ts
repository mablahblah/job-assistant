import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CollectedJob, CollectorResult } from "./types";

// Mock all collector modules
vi.mock("./adzuna", () => ({ collectAdzuna: vi.fn() }));
vi.mock("./jsearch", () => ({ collectJSearch: vi.fn() }));
vi.mock("./greenhouse", () => ({ collectGreenhouseCompany: vi.fn() }));
vi.mock("./lever", () => ({ collectLeverCompany: vi.fn() }));
vi.mock("./dribbble", () => ({ collectDribbble: vi.fn() }));
vi.mock("./weloveproduct", () => ({ collectWeLoveProduct: vi.fn() }));
vi.mock("./uiuxjobsboard", () => ({ collectUiUxJobsBoard: vi.fn() }));

// Mock config — only adzuna and greenhouse enabled
vi.mock("./collector-config", () => ({
  SEARCH_TERMS: ["product designer"],
  COLLECTOR_CONFIG: {
    adzuna: { enabled: true },
    jsearch: { enabled: false },
    dribbble: { enabled: false },
    weloveproduct: { enabled: false },
    uiuxjobsboard: { enabled: false },
    greenhouse: { enabled: true, slugs: ["acme"] },
    lever: { enabled: false, slugs: [] },
  },
}));

import { collectAll } from "./collect-all";
import { collectAdzuna } from "./adzuna";
import { collectGreenhouseCompany } from "./greenhouse";
import { collectJSearch } from "./jsearch";

const mockCollectAdzuna = collectAdzuna as ReturnType<typeof vi.fn>;
const mockCollectGreenhouse = collectGreenhouseCompany as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("collectAll", () => {
  it("calls Adzuna 4 times: 2 terms x (remote + Austin)", async () => {
    mockCollectAdzuna.mockResolvedValue([]);
    mockCollectGreenhouse.mockResolvedValue([]);

    await collectAll();

    // 1 search term in mock config x 2 modes = 2 calls
    // (real config has 2 terms = 4 calls, but mock has 1 term)
    expect(mockCollectAdzuna).toHaveBeenCalledTimes(2);

    // First call: remote
    expect(mockCollectAdzuna).toHaveBeenCalledWith({
      titleOnly: "product designer",
      what: "remote",
    });

    // Second call: Austin
    expect(mockCollectAdzuna).toHaveBeenCalledWith({
      titleOnly: "product designer",
      where: "78701",
      distance: "15",
    });
  });

  it("combines results from all enabled collectors", async () => {
    const adzunaJob: CollectedJob = {
      url: "https://adzuna.com/job/1",
      source: "adzuna",
      title: "Designer",
    };
    const greenhouseJob: CollectedJob = {
      url: "https://boards.greenhouse.io/acme/jobs/101",
      source: "greenhouse-api",
      title: "Product Designer",
    };

    mockCollectAdzuna.mockResolvedValue([adzunaJob]);
    mockCollectGreenhouse.mockResolvedValue([greenhouseJob]);

    const result = await collectAll();

    // 2 Adzuna calls (remote + Austin) each returning 1 job + 1 greenhouse
    expect(result.jobs).toHaveLength(3);
    expect(result.jobs).toContainEqual(adzunaJob);
    expect(result.jobs).toContainEqual(greenhouseJob);
  });

  it("skips disabled collectors", async () => {
    mockCollectAdzuna.mockResolvedValue([]);
    mockCollectGreenhouse.mockResolvedValue([]);

    await collectAll();

    expect(collectJSearch).not.toHaveBeenCalled();
  });

  it("continues when one collector fails, captures the error", async () => {
    mockCollectAdzuna.mockRejectedValue(new Error("API down"));
    mockCollectGreenhouse.mockResolvedValue([{
      url: "https://boards.greenhouse.io/acme/jobs/101",
      source: "greenhouse-api",
    }]);

    const result = await collectAll();

    // Greenhouse still works
    expect(result.jobs).toHaveLength(1);
    // Adzuna errors captured
    const adzunaResults = result.results.filter((r: CollectorResult) => r.source === "adzuna");
    expect(adzunaResults.length).toBeGreaterThan(0);
    expect(adzunaResults.some((r: CollectorResult) => r.error === "API down")).toBe(true);
  });
});
