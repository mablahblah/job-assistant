import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma before importing the module under test
vi.mock("@/lib/prisma", () => ({
  prisma: {
    company: {
      findFirst: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

import { resolveCompanyName, clearCompanyCache } from "./company-cache";
import { prisma } from "@/lib/prisma";

const mockPrisma = prisma as unknown as {
  company: {
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.resetAllMocks();
  clearCompanyCache();
});

describe("resolveCompanyName", () => {
  it("returns cached name from DB when atsPlatform+atsSlug match", async () => {
    mockPrisma.company.findFirst.mockResolvedValue({ name: "GitLab" });

    const name = await resolveCompanyName("greenhouse", "gitlab");
    expect(name).toBe("GitLab");
    expect(mockPrisma.company.findFirst).toHaveBeenCalledWith({
      where: { atsPlatform: "greenhouse", atsSlug: "gitlab" },
      select: { name: true },
    });
  });

  it("uses in-memory cache on second call for same slug", async () => {
    mockPrisma.company.findFirst.mockResolvedValue({ name: "GitLab" });

    await resolveCompanyName("greenhouse", "gitlab");
    const name = await resolveCompanyName("greenhouse", "gitlab");
    expect(name).toBe("GitLab");
    // DB only queried once — second call hits in-memory cache
    expect(mockPrisma.company.findFirst).toHaveBeenCalledTimes(1);
  });

  it("returns null when no DB match and no fetcher provided", async () => {
    mockPrisma.company.findFirst.mockResolvedValue(null);

    const name = await resolveCompanyName("greenhouse", "unknown-co");
    expect(name).toBeNull();
  });

  it("calls fetcher when DB miss, caches result", async () => {
    mockPrisma.company.findFirst.mockResolvedValue(null);
    mockPrisma.company.upsert.mockResolvedValue({ id: "1", name: "Plaid" });
    const fetcher = vi.fn().mockResolvedValue("Plaid");

    const name = await resolveCompanyName("lever", "plaid", fetcher);
    expect(name).toBe("Plaid");
    expect(fetcher).toHaveBeenCalledWith("plaid");

    // Stores atsPlatform + atsSlug on the company record
    expect(mockPrisma.company.upsert).toHaveBeenCalledWith({
      where: { name: "Plaid" },
      create: { name: "Plaid", atsPlatform: "lever", atsSlug: "plaid" },
      update: { atsPlatform: "lever", atsSlug: "plaid" },
    });
  });

  it("returns null when fetcher returns null", async () => {
    mockPrisma.company.findFirst.mockResolvedValue(null);
    const fetcher = vi.fn().mockResolvedValue(null);

    const name = await resolveCompanyName("greenhouse", "dead-co", fetcher);
    expect(name).toBeNull();
    expect(mockPrisma.company.upsert).not.toHaveBeenCalled();
  });

  it("caches negative result so fetcher is not retried", async () => {
    mockPrisma.company.findFirst.mockResolvedValue(null);
    const fetcher = vi.fn().mockResolvedValue(null);

    await resolveCompanyName("lever", "gone-co", fetcher);
    const second = await resolveCompanyName("lever", "gone-co", fetcher);
    expect(second).toBeNull();
    // Fetcher only called once — second call hits cached miss
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
