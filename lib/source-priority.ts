// One parsed line from the priority list, such as "collector:greenhouse".
export interface PriorityEntry {
  kind: "collector" | "parser";
  name: string;
}

// The two names a side of a contested field can carry: the collector that
// produced the job and the parser that read it. Either may be absent.
export interface PrioritySide {
  collector?: string | null;
  parser?: string | null;
}

// Splits one priority list line into its kind and name. The kind is whatever
// sits before the first colon and the name is everything after it, so a name
// holding further colons is left intact. Anything else is not an entry: no
// colon at all, an empty name, or a kind other than collector or parser. A
// side is only ever one of those two, so an entry of another kind could
// never match one.
export function parsePriorityEntry(entry: string): PriorityEntry | null {
  const colonIndex = entry.indexOf(":");
  if (colonIndex === -1) {
    return null;
  }

  const kind = entry.slice(0, colonIndex);
  const name = entry.slice(colonIndex + 1);

  if (kind !== "collector" && kind !== "parser") {
    return null;
  }
  if (name === "") {
    return null;
  }

  return { kind, name };
}

// Ranks a side against the priority list, where a lower number is better.
// A side's rank is the better of where its collector name and its parser
// name sit, each matched only against an entry of its own kind, so
// reordering one never silently moves the other.
//
// A rank of null means the side appears nowhere in the list, which is a
// different answer from ranking last: two absent sides leave the stored
// value standing, while two sides that tie let the later copy win.
export function sideRank(list: readonly string[], side: PrioritySide): number | null {
  // The list runs best first, so the first match found is the best one.
  for (const [index, line] of list.entries()) {
    const entry = parsePriorityEntry(line);
    if (entry === null) {
      continue;
    }

    const matchesCollector =
      entry.kind === "collector" && side.collector != null && side.collector === entry.name;
    const matchesParser =
      entry.kind === "parser" && side.parser != null && side.parser === entry.name;

    if (matchesCollector || matchesParser) {
      return index;
    }
  }

  return null;
}
