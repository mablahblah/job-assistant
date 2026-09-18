// Whether two paths name one file. A path is a name a file answers to, not
// the file itself, so comparing two paths as text is not the same question.
// This disk is case-insensitive, which makes "pipeline.db" and "Pipeline.db"
// two spellings of one file, and a shortcut is a second name reaching the
// same file down an entirely different path.
//
// The caller deletes whatever its target names. One wrong "no, different
// file" deletes a database holding filings that cannot be made again, so the
// answer is asked of the filesystem rather than worked out from the letters.
import { statSync } from "node:fs";
import { resolve } from "node:path";

type Examined =
  | { kind: "exists"; dev: number; ino: number }
  | { kind: "absent" }
  | { kind: "unknown" };

// "Confirmed not there" is kept apart from "could not look", because only
// the first of those lets the answer below be certain.
function examine(path: string): Examined {
  try {
    const stats = statSync(path);
    return { kind: "exists", dev: stats.dev, ino: stats.ino };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { kind: "absent" };
    }
    return { kind: "unknown" };
  }
}

export function isSameFile(a: string, b: string): boolean {
  const left = examine(a);
  const right = examine(b);

  // A refused read rather than a clean "not found". With no way to know,
  // refusing too much is the side of the mistake that keeps the data.
  if (left.kind === "unknown" || right.kind === "unknown") {
    return true;
  }

  // The filesystem resolves each path to the device and the record number it
  // actually lives at. That pair survives capitalization, `..` segments,
  // relative against absolute spelling, and shortcuts — so two names for one
  // file match here even where their text never would.
  if (left.kind === "exists" && right.kind === "exists") {
    return left.dev === right.dev && left.ino === right.ino;
  }

  // One path reaches a real file and the other reaches nothing, so they are
  // not one file whatever they are spelled like.
  if (left.kind !== right.kind) {
    return false;
  }

  // Neither exists, so there is no file left to ask. The text is all that
  // remains, compared the way this disk compares names, so a path that does
  // not exist yet is not cleared as different from one it would collide with.
  return resolve(a).toLowerCase() === resolve(b).toLowerCase();
}
