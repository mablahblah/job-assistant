import { describe, it, expect } from "vitest";
import { prefilterLocation } from "./prefilter";

describe("prefilterLocation", () => {
  // --- Skip patterns ---

  describe("skips un-geocodable strings", () => {
    it("skips empty string", () => {
      const result = prefilterLocation("");
      expect(result).toEqual({ fragments: [], action: "skipped" });
    });

    it("skips whitespace", () => {
      const result = prefilterLocation("   ");
      expect(result).toEqual({ fragments: [], action: "skipped" });
    });

    it("skips bare 'Remote'", () => {
      const result = prefilterLocation("Remote");
      expect(result).toEqual({ fragments: [], action: "skipped" });
    });

    it("skips 'Remote US'", () => {
      const result = prefilterLocation("Remote US");
      expect(result).toEqual({ fragments: [], action: "skipped" });
    });

    it("skips 'Remote - US'", () => {
      const result = prefilterLocation("Remote - US");
      expect(result).toEqual({ fragments: [], action: "skipped" });
    });

    it("skips 'Remote (US only)'", () => {
      const result = prefilterLocation("Remote (US only)");
      expect(result).toEqual({ fragments: [], action: "skipped" });
    });

    it("skips 'LATAM, Remote'", () => {
      const result = prefilterLocation("LATAM, Remote");
      expect(result).toEqual({ fragments: [], action: "skipped" });
    });

    it("skips 'Remote- United States'", () => {
      const result = prefilterLocation("Remote- United States");
      expect(result).toEqual({ fragments: [], action: "skipped" });
    });

    it("skips bare 'US'", () => {
      const result = prefilterLocation("US");
      expect(result).toEqual({ fragments: [], action: "skipped" });
    });

    it("skips bare 'USA'", () => {
      const result = prefilterLocation("USA");
      expect(result).toEqual({ fragments: [], action: "skipped" });
    });

    it("skips 'United States'", () => {
      const result = prefilterLocation("United States");
      expect(result).toEqual({ fragments: [], action: "skipped" });
    });

    it("does NOT skip 'US' embedded in a city string", () => {
      const result = prefilterLocation("Chattanooga, TN, US, Tennessee, United States");
      expect(result.fragments).toEqual(["Chattanooga, TN, US, Tennessee, United States"]);
      expect(result.action).toBe("passthrough");
    });
  });

  // --- Suffix stripping ---

  describe("strips office/HQ suffixes", () => {
    it("strips (HQ) suffix", () => {
      const result = prefilterLocation("San Francisco (HQ)");
      expect(result.fragments).toEqual(["San Francisco"]);
      expect(result.action).toBe("cleaned");
    });

    it("strips -HQ suffix", () => {
      const result = prefilterLocation("San Francisco-HQ");
      expect(result.fragments).toEqual(["San Francisco"]);
      expect(result.action).toBe("cleaned");
    });

    it("strips ' Office' suffix", () => {
      const result = prefilterLocation("New York Office");
      expect(result.fragments).toEqual(["New York"]);
      expect(result.action).toBe("cleaned");
    });

    it("strips ' Office' suffix from London", () => {
      const result = prefilterLocation("London Office");
      expect(result.fragments).toEqual(["London"]);
      expect(result.action).toBe("cleaned");
    });
  });

  // --- Prefix stripping ---

  describe("strips company prefixes", () => {
    it("strips 'Binti HQ - '", () => {
      const result = prefilterLocation("Binti HQ - San Francisco, CA");
      expect(result.fragments).toEqual(["San Francisco, CA"]);
      expect(result.action).toBe("cleaned");
    });

    it("strips 'Hub - '", () => {
      const result = prefilterLocation("Hub - San Francisco");
      expect(result.fragments).toEqual(["San Francisco"]);
      expect(result.action).toBe("cleaned");
    });

    it("strips 'Right Formula '", () => {
      const result = prefilterLocation("Right Formula London");
      expect(result.fragments).toEqual(["London"]);
      expect(result.action).toBe("cleaned");
    });
  });

  // --- Splitting patterns ---

  describe("splits multi-location strings", () => {
    it("splits on semicolons", () => {
      const result = prefilterLocation("New York, NY; San Francisco, CA");
      expect(result.fragments).toEqual(["New York, NY", "San Francisco, CA"]);
      expect(result.action).toBe("split");
    });

    it("splits on ampersands", () => {
      const result = prefilterLocation("London & NYC");
      expect(result.fragments).toEqual(["London", "NYC"]);
      expect(result.action).toBe("split");
    });

    it("splits on bullets", () => {
      const result = prefilterLocation(
        "San Francisco, CA • New York, NY"
      );
      expect(result.fragments).toEqual([
        "San Francisco, CA",
        "New York, NY",
      ]);
      expect(result.action).toBe("split");
    });

    it("splits on slashes and filters country-only fragments", () => {
      const result = prefilterLocation("UK / US");
      // "US" is filtered as a bare country name; "UK" remains
      expect(result.fragments).toEqual(["UK"]);
      expect(result.action).toBe("split");
    });
  });

  // --- Strip-then-split patterns ---

  describe("strips work-mode qualifiers then splits", () => {
    it("strips Remote from comma-separated list", () => {
      const result = prefilterLocation("Remote, SF, NYC");
      expect(result.fragments).toEqual(["SF", "NYC"]);
    });

    it("strips 'fully remote' from slash-separated", () => {
      const result = prefilterLocation("Berlin / fully remote");
      expect(result.fragments).toEqual(["Berlin"]);
    });

    it("handles complex multi-location with qualifiers", () => {
      const result = prefilterLocation(
        "Atlanta - Hybrid, Toronto - Remote, United Kingdom (Remote), Frankfurt, Vancouver - Remote"
      );
      // Should strip Hybrid, Remote qualifiers, then split remaining fragments
      expect(result.fragments).toContain("Atlanta");
      expect(result.fragments).toContain("Frankfurt");
      // Toronto, UK, Vancouver should either be stripped or cleaned
      expect(
        result.fragments.every(
          (f) => !f.toLowerCase().includes("remote") && !f.toLowerCase().includes("hybrid")
        )
      ).toBe(true);
    });
  });

  // --- Passthrough (no changes needed) ---

  describe("passes through clean location strings", () => {
    it("passes through 'Austin, Texas'", () => {
      const result = prefilterLocation("Austin, Texas");
      expect(result).toEqual({
        fragments: ["Austin, Texas"],
        action: "passthrough",
      });
    });

    it("passes through 'Seattle, King County'", () => {
      const result = prefilterLocation("Seattle, King County");
      expect(result).toEqual({
        fragments: ["Seattle, King County"],
        action: "passthrough",
      });
    });

    it("passes through 'Dallas, TX'", () => {
      const result = prefilterLocation("Dallas, TX");
      expect(result).toEqual({
        fragments: ["Dallas, TX"],
        action: "passthrough",
      });
    });

    it("passes through verbose format", () => {
      const result = prefilterLocation(
        "Chattanooga, TN, US, Tennessee, United States"
      );
      expect(result).toEqual({
        fragments: ["Chattanooga, TN, US, Tennessee, United States"],
        action: "passthrough",
      });
    });
  });
});
