import { describe, expect, test } from "vitest";
import { readAtsBoards } from "./ats-boards";
import type { AtsCompany, SettingsService } from "../settings-service";
import { fakeSettings } from "../settings-service.fake";

// A settings-service stand-in. getAtsCompanies answers with whatever a test
// set up for a platform and remembers every platform it was asked about, so a
// test can check the request without a mocking library.
interface FakeSettings extends SettingsService {
  platformsAsked: string[];
}

function makeSettings(companiesByPlatform: Record<string, AtsCompany[]>): FakeSettings {
  const platformsAsked: string[] = [];
  return {
    ...fakeSettings({
      async getAtsCompanies(platform: string) {
        platformsAsked.push(platform);
        return companiesByPlatform[platform] ?? [];
      },
    }),
    platformsAsked,
  };
}

const stripe: AtsCompany = { ats_slug: "stripe" };
const figma: AtsCompany = { ats_slug: "figma" };

describe("AC 76: a platform with companies returns exactly those boards", () => {
  test("boards are the companies the settings service holds for that platform", async () => {
    const settings = makeSettings({ greenhouse: [stripe, figma] });
    const result = await readAtsBoards(settings, "greenhouse");
    expect(result.boards).toEqual([stripe, figma]);
  });

  test("no warning is recorded", async () => {
    const settings = makeSettings({ greenhouse: [stripe] });
    const result = await readAtsBoards(settings, "greenhouse");
    expect(result.warnings).toEqual([]);
  });
});

describe("AC 76: a platform with no boards warns rather than staying silent", () => {
  test("boards is empty", async () => {
    const settings = makeSettings({});
    const result = await readAtsBoards(settings, "lever");
    expect(result.boards).toEqual([]);
  });

  test("exactly one warning is recorded", async () => {
    const settings = makeSettings({});
    const result = await readAtsBoards(settings, "lever");
    expect(result.warnings).toHaveLength(1);
  });

  test("the warning names the platform", async () => {
    // The wording is free to change; naming the platform is the part that
    // makes the warning actionable.
    const settings = makeSettings({});
    const result = await readAtsBoards(settings, "lever");
    expect(result.warnings[0]).toContain("lever");
  });

  test("readAtsBoards resolves rather than rejecting", async () => {
    // An emptied platform is how that platform is switched off, so it is a
    // real answer rather than a broken database.
    const settings = makeSettings({});
    await expect(readAtsBoards(settings, "lever")).resolves.toBeDefined();
  });
});

describe("AC 76: readAtsBoards asks for the platform it was given", () => {
  test("only the requested platform is asked for", async () => {
    const settings = makeSettings({ greenhouse: [stripe], lever: [figma] });
    await readAtsBoards(settings, "greenhouse");
    expect(settings.platformsAsked).toEqual(["greenhouse"]);
  });
});
