import { beforeEach, afterEach, describe, expect, test } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fixturePath, pickFixture, readFixture, writeFixture, type FixtureCandidate } from "./fixture";

// Every test but the "real default location" one below points
// COLLECTOR_FIXTURE_DIR at a scratch directory, so nothing here ever touches
// the committed fixtures under lib/collectors/fixtures.
let originalFixtureDir: string | undefined;
let tempDir: string;

beforeEach(() => {
  originalFixtureDir = process.env.COLLECTOR_FIXTURE_DIR;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-fixture-"));
  process.env.COLLECTOR_FIXTURE_DIR = tempDir;
});

afterEach(() => {
  if (originalFixtureDir === undefined) {
    delete process.env.COLLECTOR_FIXTURE_DIR;
  } else {
    process.env.COLLECTOR_FIXTURE_DIR = originalFixtureDir;
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("fixturePath", () => {
  test("returns an absolute path", () => {
    expect(path.isAbsolute(fixturePath("acme"))).toBe(true);
  });

  test("names the file after the collector and marks it as html", () => {
    expect(path.basename(fixturePath("acme"))).toBe("acme.html");
  });

  test("sits under a fixtures directory inside lib/collectors when no override is set", () => {
    // This one deliberately runs against the real default location, so the
    // override the other tests rely on is removed just for this call.
    delete process.env.COLLECTOR_FIXTURE_DIR;

    const result = fixturePath("acme");

    expect(result).toContain(path.join("lib", "collectors", "fixtures"));
    expect(path.basename(result)).toBe("acme.html");
  });

  test("is a pure lookup: it creates neither the directory nor the file", () => {
    const missingDir = path.join(tempDir, "not-yet-created");
    process.env.COLLECTOR_FIXTURE_DIR = missingDir;

    const result = fixturePath("acme");

    expect(fs.existsSync(missingDir)).toBe(false);
    expect(fs.existsSync(result)).toBe(false);
  });
});

describe("readFixture", () => {
  test("returns the file's contents when the fixture exists", () => {
    fs.writeFileSync(fixturePath("acme"), "<div>a card</div>");

    expect(readFixture("acme")).toBe("<div>a card</div>");
  });

  test("throws when the fixture is missing", () => {
    expect(() => readFixture("acme")).toThrow();
  });

  test("the thrown message names the collector rather than surfacing a raw ENOENT", () => {
    try {
      readFixture("acme");
      throw new Error("readFixture should have thrown");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("acme");
      expect(message).not.toContain("ENOENT");
    }
  });

  test("the thrown message points at the command that would create the fixture", () => {
    try {
      readFixture("acme");
      throw new Error("readFixture should have thrown");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message.toLowerCase()).toContain("collect");
    }
  });
});

describe("writeFixture on a clean run", () => {
  test("writes the html so reading it back gives exactly what was written", () => {
    writeFixture("acme", "<div>fresh card</div>", { selfCheckFailed: false });

    expect(readFixture("acme")).toBe("<div>fresh card</div>");
  });

  test("returns no warnings", () => {
    const warnings = writeFixture("acme", "<div>fresh card</div>", { selfCheckFailed: false });

    expect(warnings).toEqual([]);
  });

  test("creates the fixtures directory when it does not already exist", () => {
    const missingDir = path.join(tempDir, "missing-dir");
    process.env.COLLECTOR_FIXTURE_DIR = missingDir;

    writeFixture("acme", "<div>fresh card</div>", { selfCheckFailed: false });

    expect(fs.existsSync(missingDir)).toBe(true);
    expect(readFixture("acme")).toBe("<div>fresh card</div>");
  });
});

describe("writeFixture on a run whose self-check failed", () => {
  test("leaves an existing fixture's contents completely untouched", () => {
    writeFixture("acme", "<div>good baseline</div>", { selfCheckFailed: false });

    writeFixture("acme", "<div>broken run</div>", { selfCheckFailed: true });

    expect(readFixture("acme")).toBe("<div>good baseline</div>");
  });

  test("creates no file where none existed", () => {
    writeFixture("acme", "<div>broken run</div>", { selfCheckFailed: true });

    expect(fs.existsSync(fixturePath("acme"))).toBe(false);
  });

  test("returns a single warning naming the collector and explaining the fixture was left alone", () => {
    const warnings = writeFixture("acme", "<div>broken run</div>", { selfCheckFailed: true });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("acme");
    expect(warnings[0].toLowerCase()).toContain("clean");
  });
});

describe("writeFixture never throws, even when the write itself fails", () => {
  test("a directory that cannot be created returns a warning instead of throwing", () => {
    // The parent segment is a plain file, so mkdir on the path below it fails.
    const blockingFile = path.join(tempDir, "blocked");
    fs.writeFileSync(blockingFile, "not a directory");
    process.env.COLLECTOR_FIXTURE_DIR = path.join(blockingFile, "fixtures");

    let warnings: string[] = [];
    expect(() => {
      warnings = writeFixture("acme", "<div>fresh card</div>", { selfCheckFailed: false });
    }).not.toThrow();

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("acme");
  });
});

describe("writeFixture refuses an empty string", () => {
  test("a good fixture is not overwritten with nothing", () => {
    writeFixture("acme", "<div>good baseline</div>", { selfCheckFailed: false });

    writeFixture("acme", "", { selfCheckFailed: false });

    expect(readFixture("acme")).toBe("<div>good baseline</div>");
  });

  test("returns a warning naming the collector instead of writing", () => {
    writeFixture("acme", "<div>good baseline</div>", { selfCheckFailed: false });

    const warnings = writeFixture("acme", "", { selfCheckFailed: false });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("acme");
  });
});

// A small factory so each test only states the field it cares about.
function makeCandidate(overrides: Partial<FixtureCandidate> = {}): FixtureCandidate {
  return {
    html: "<div>a card</div>",
    cards: 1,
    selfCheckFailed: false,
    ...overrides,
  };
}

describe("pickFixture", () => {
  test("picks a candidate that has cards when there is no best yet", () => {
    const candidate = makeCandidate({ cards: 3 });

    expect(pickFixture(null, candidate)).toBe(candidate);
  });

  // A container with nothing in it, or nothing at all, proves nothing about
  // the site's markup and is never worth keeping as a starting point.
  test("never picks a candidate with zero cards, even with no best yet", () => {
    const candidate = makeCandidate({ cards: 0 });

    expect(pickFixture(null, candidate)).toBeNull();
  });

  test("never picks a candidate with empty html, even with no best yet", () => {
    const candidate = makeCandidate({ html: "", cards: 3 });

    expect(pickFixture(null, candidate)).toBeNull();
  });

  // Among equally clean candidates, more cards is simply a better sample.
  test("prefers a candidate with more cards over a best with fewer, when both are equally clean", () => {
    const best = makeCandidate({ cards: 2 });
    const candidate = makeCandidate({ cards: 5 });

    expect(pickFixture(best, candidate)).toBe(candidate);
  });

  test("keeps a best with more cards rather than a candidate with fewer", () => {
    const best = makeCandidate({ cards: 5 });
    const candidate = makeCandidate({ cards: 2 });

    expect(pickFixture(best, candidate)).toBe(best);
  });

  test("keeps the incumbent best when the candidate has the same card count", () => {
    const best = makeCandidate({ cards: 3 });
    const candidate = makeCandidate({ cards: 3 });

    expect(pickFixture(best, candidate)).toBe(best);
  });

  // A page from a search that went wrong is not a baseline worth keeping,
  // however big it happens to be.
  test("prefers a clean candidate over a degraded best, however many cards the degraded one holds", () => {
    const best = makeCandidate({ cards: 50, selfCheckFailed: true });
    const candidate = makeCandidate({ cards: 1, selfCheckFailed: false });

    expect(pickFixture(best, candidate)).toBe(candidate);
  });

  test("keeps a clean best rather than a degraded candidate, however many cards the degraded one holds", () => {
    const best = makeCandidate({ cards: 1, selfCheckFailed: false });
    const candidate = makeCandidate({ cards: 50, selfCheckFailed: true });

    expect(pickFixture(best, candidate)).toBe(best);
  });

  // When every search in the run was degraded, the best available fallback
  // is still whichever held more cards.
  test("compares two degraded candidates by card count", () => {
    const best = makeCandidate({ cards: 2, selfCheckFailed: true });
    const candidate = makeCandidate({ cards: 5, selfCheckFailed: true });

    expect(pickFixture(best, candidate)).toBe(candidate);
  });

  test("returns the exact object it kept, not a copy of it", () => {
    const best = makeCandidate({ cards: 1 });
    const candidate = makeCandidate({ cards: 5 });

    expect(pickFixture(best, candidate)).toBe(candidate);
    expect(pickFixture(candidate, best)).toBe(candidate);
  });

  test("mutates neither input, which a frozen object would throw over", () => {
    const best = Object.freeze(makeCandidate({ cards: 2, html: "<div>best</div>" }));
    const candidate = Object.freeze(makeCandidate({ cards: 5, html: "<div>candidate</div>" }));

    expect(pickFixture(best, candidate)).toBe(candidate);
    expect(best.cards).toBe(2);
    expect(candidate.cards).toBe(5);
  });
});
