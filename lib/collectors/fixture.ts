// Each browser-based collector saves the HTML of its results container here
// after a real run, and an offline test replays that fixture to catch a site
// quietly changing its markup. A run whose self-check already failed must not
// overwrite the fixture — doing so would write the run's own breakage into
// the very baseline the test exists to catch it against.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { messageFromThrown } from "../utils/thrown-message";

// Every warning is worded here, so its wording changes in one place.
const WARNINGS = {
  selfCheckFailed: (name: string): string =>
    `${name}: fixture left alone — the run did not check out clean`,
  emptyHtml: (name: string): string =>
    `${name}: fixture left alone — refusing to overwrite it with empty html`,
  writeFailed: (name: string, reason: string): string =>
    `${name}: fixture not saved — ${reason}`,
};

// Derived from the module's own url rather than from `import.meta.dirname`,
// which tsx leaves undefined while vitest fills it in. A path built from the
// undefined one throws only when a command runs for real.
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

// Read per call rather than at module load, so a test can point this at a
// scratch directory for the length of one test.
function fixtureDir(): string {
  return process.env.COLLECTOR_FIXTURE_DIR ?? path.join(MODULE_DIR, "fixtures");
}

export function fixturePath(name: string): string {
  return path.join(fixtureDir(), `${name}.html`);
}

export function readFixture(name: string): string {
  try {
    return fs.readFileSync(fixturePath(name), "utf8");
  } catch {
    throw new Error(
      `${name}: no fixture found — run "npm run collect" to create one from a real run`
    );
  }
}

// Never throws. Every refusal and every failure comes back as a warning, so a
// collection that worked is never reported as a collector that failed.
export function writeFixture(
  name: string,
  html: string,
  options: { selfCheckFailed: boolean }
): string[] {
  if (options.selfCheckFailed) {
    return [WARNINGS.selfCheckFailed(name)];
  }

  // A blank container is what a broken selector produces, and it would
  // replace a good baseline with one that proves nothing.
  if (html === "") {
    return [WARNINGS.emptyHtml(name)];
  }

  try {
    fs.mkdirSync(fixtureDir(), { recursive: true });
    fs.writeFileSync(fixturePath(name), html, "utf8");
    return [];
  } catch (error) {
    return [WARNINGS.writeFailed(name, messageFromThrown(error))];
  }
}

// One results container from a single search, held as a candidate rather
// than written straight away. A run makes several searches, and only the
// strongest of them should end up on disk.
export interface FixtureCandidate {
  html: string;
  cards: number;
  selfCheckFailed: boolean;
}

// A candidate with no cards, or no html at all, cannot serve as a baseline:
// it is either a search that matched nothing or a container the site never
// rendered.
function isUsable(candidate: FixtureCandidate): boolean {
  return candidate.cards > 0 && candidate.html !== "";
}

// Cleanliness beats size. A self-check failure means something went wrong on
// the page the candidate came from, and no number of cards makes that a
// baseline worth keeping. An equal card count keeps the incumbent, so a run
// does not churn between equals.
function isBetter(best: FixtureCandidate, candidate: FixtureCandidate): boolean {
  if (candidate.selfCheckFailed !== best.selfCheckFailed) {
    return !candidate.selfCheckFailed;
  }
  return candidate.cards > best.cards;
}

// Called once per search with the best seen so far, so the fixture a run
// commits is the strongest container it saw rather than whichever search
// happened to run last. Keeping the last one left a real fixture holding a
// single card, which proves almost nothing about the site's markup.
export function pickFixture(
  best: FixtureCandidate | null,
  candidate: FixtureCandidate
): FixtureCandidate | null {
  if (!isUsable(candidate)) return best;
  if (best === null) return candidate;
  return isBetter(best, candidate) ? candidate : best;
}
