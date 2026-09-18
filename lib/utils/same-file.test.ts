// The guard in the rebuild command is the only thing standing between a
// mistyped argument and the real database, so the comparison behind it is
// tested here against scratch files rather than through the command. A test
// that drove the command at the real database would destroy it on the run
// that proves the bug.
import { describe, expect, test, afterAll } from "vitest";
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { isSameFile } from "./same-file";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "same-file-test-"));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("telling whether two paths name one file", () => {
  test("two different files are not the same file", () => {
    const dir = makeTempDir();
    const one = join(dir, "one.db");
    const two = join(dir, "two.db");
    writeFileSync(one, "");
    writeFileSync(two, "");

    expect(isSameFile(one, two)).toBe(false);
  });

  test("a path and the same path written the long way round are the same file", () => {
    const dir = makeTempDir();
    const target = join(dir, "pipeline.db");
    writeFileSync(target, "");
    const roundabout = join(dir, "nested", "..", "pipeline.db");

    expect(isSameFile(target, roundabout)).toBe(true);
  });

  test("a relative path and an absolute one naming one file are the same file", () => {
    const dir = makeTempDir();
    const target = join(dir, "pipeline.db");
    writeFileSync(target, "");

    expect(isSameFile(target, resolve(dir, relative(dir, target)))).toBe(true);
  });

  // The bug this whole util exists for. On a case-insensitive disk, which is
  // the Mac default, `Pipeline.db` and `pipeline.db` are one file, and a
  // guard comparing the two strings lets the second through to be deleted.
  test("the same file spelled with different capitals is the same file", () => {
    const dir = makeTempDir();
    const lower = join(dir, "pipeline.db");
    writeFileSync(lower, "");
    const upper = join(dir, "Pipeline.db");

    // Only meaningful where the disk folds case. On a disk that does not,
    // these genuinely are two files and the answer below would be wrong.
    if (!existsSync(upper)) return;

    expect(isSameFile(lower, upper)).toBe(true);
  });

  test("a shortcut and the file it points at are the same file", () => {
    const dir = makeTempDir();
    const target = join(dir, "pipeline.db");
    const link = join(dir, "link.db");
    writeFileSync(target, "");
    symlinkSync(target, link);

    expect(isSameFile(target, link)).toBe(true);
  });

  // The ordinary case: the command is pointed at a database it is about to
  // build, which does not exist yet. That must not read as the real one.
  test("a file that does not exist yet is not the file that does", () => {
    const dir = makeTempDir();
    const existing = join(dir, "pipeline.db");
    writeFileSync(existing, "");

    expect(isSameFile(join(dir, "scratch.db"), existing)).toBe(false);
  });

  test("two paths that both name nothing are compared by their text", () => {
    const dir = makeTempDir();

    expect(isSameFile(join(dir, "a.db"), join(dir, "b.db"))).toBe(false);
    expect(isSameFile(join(dir, "a.db"), join(dir, "a.db"))).toBe(true);
  });
});
