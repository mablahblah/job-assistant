import { describe, expect, test } from "vitest";
import { readAtsBoards, type AtsBoard } from "./ats-boards";
import type { AtsSlugRecord, AtsSlugService } from "../services/ats-slug-service";
import { fakeAtsSlugService } from "../services/ats-slug-service.fake";

// A slug-service stand-in. It answers with whatever rows a test set up and
// remembers every collector it was asked about, so a test can check the
// request without a mocking library.
interface FakeSlugs extends AtsSlugService {
  collectorsAsked: string[];
}

function row(slug: string, collector: string | null): AtsSlugRecord {
  return { id: `row-${slug}`, slug, company_id: `company-${slug}`, parser: "greenhouse", collector };
}

function makeSlugs(rows: AtsSlugRecord[]): FakeSlugs {
  const collectorsAsked: string[] = [];
  const service = fakeAtsSlugService(rows);
  return {
    ...service,
    async listForCollector(collector: string) {
      collectorsAsked.push(collector);
      return service.listForCollector(collector);
    },
    collectorsAsked,
  };
}

const stripe: AtsBoard = { ats_slug: "stripe" };
const figma: AtsBoard = { ats_slug: "figma" };

describe("AC 76: a collector with boards returns exactly those boards", () => {
  test("boards are the slug rows carrying that collector", async () => {
    const slugs = makeSlugs([row("stripe", "greenhouse"), row("figma", "greenhouse")]);
    const result = await readAtsBoards(slugs, "greenhouse");
    expect(result.boards).toEqual([stripe, figma]);
  });

  test("no warning is recorded", async () => {
    const slugs = makeSlugs([row("stripe", "greenhouse")]);
    const result = await readAtsBoards(slugs, "greenhouse");
    expect(result.warnings).toEqual([]);
  });

  // A row with no collector records only that a company posts on a hiring
  // system. Nothing polls that board until promotion fills the collector in.
  test("a row carrying no collector is not a board", async () => {
    const slugs = makeSlugs([row("stripe", null)]);
    const result = await readAtsBoards(slugs, "greenhouse");
    expect(result.boards).toEqual([]);
  });
});

describe("AC 76: a collector with no boards warns rather than staying silent", () => {
  test("boards is empty", async () => {
    const slugs = makeSlugs([]);
    const result = await readAtsBoards(slugs, "lever");
    expect(result.boards).toEqual([]);
  });

  test("exactly one warning is recorded", async () => {
    const slugs = makeSlugs([]);
    const result = await readAtsBoards(slugs, "lever");
    expect(result.warnings).toHaveLength(1);
  });

  test("the warning names the collector", async () => {
    // The wording is free to change; naming the collector is the part that
    // makes the warning actionable.
    const slugs = makeSlugs([]);
    const result = await readAtsBoards(slugs, "lever");
    expect(result.warnings[0]).toContain("lever");
  });

  test("readAtsBoards resolves rather than rejecting", async () => {
    // An emptied collector is how that collector is switched off, so it is a
    // real answer rather than a broken database.
    const slugs = makeSlugs([]);
    await expect(readAtsBoards(slugs, "lever")).resolves.toBeDefined();
  });
});

describe("AC 76: readAtsBoards asks for the collector it was given", () => {
  test("only the requested collector is asked for", async () => {
    const slugs = makeSlugs([row("stripe", "greenhouse"), row("figma", "lever")]);
    await readAtsBoards(slugs, "greenhouse");
    expect(slugs.collectorsAsked).toEqual(["greenhouse"]);
  });

  test("a board on another collector's list is left off", async () => {
    const slugs = makeSlugs([row("stripe", "greenhouse"), row("figma", "lever")]);
    const result = await readAtsBoards(slugs, "greenhouse");
    expect(result.boards).toEqual([stripe]);
  });
});
