// A util takes values and returns values. It sits at the bottom of the app,
// so nothing above it may be named in one of its imports — otherwise the
// folder that is supposed to depend on nothing depends on the pipeline.
//
// The test lives in `lib/utils/` rather than beside the naming rule, because
// `lib/` holds no file of its own and utils is the folder the rule is being
// read against. A shape two folders share belongs in `lib/types/`, which is
// what a failure here is telling the reader to do.
import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const UTILS_DIR = join(import.meta.dirname, ".");

// The folders a util may never import from. Both hold code that runs at a
// pipeline position, which is above a plain function by definition.
const FORBIDDEN = ["handlers", "orchestrators"];

function utilSourceFiles(): string[] {
  return readdirSync(UTILS_DIR).filter(
    (name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".fake.ts"),
  );
}

// Matches both a value import and a type-only one, because a type-only import
// is still the util naming a file it must not know about.
function forbiddenImports(source: string): string[] {
  const found: string[] = [];
  for (const folder of FORBIDDEN) {
    const pattern = new RegExp(`from\\s+["']\\.\\./${folder}/`, "g");
    if (pattern.test(source)) found.push(folder);
  }
  return found;
}

describe("a util imports from nothing above it", () => {
  test("no util names a handler or an orchestrator in an import", () => {
    const offenders: string[] = [];

    for (const file of utilSourceFiles()) {
      const source = readFileSync(join(UTILS_DIR, file), "utf8");
      for (const folder of forbiddenImports(source)) {
        offenders.push(`${file} imports from lib/${folder}/`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
