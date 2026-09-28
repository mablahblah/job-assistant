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

// Finds where one named entry of one kind sits in the list, skipping junk
// entries, or null when it sits nowhere.
function findEntryRank(list: readonly string[], kind: "collector" | "parser", name: string): number | null {
  for (const [index, line] of list.entries()) {
    const entry = parsePriorityEntry(line);
    if (entry !== null && entry.kind === kind && entry.name === name) {
      return index;
    }
  }
  return null;
}

// Ranks a side against the priority list, where a lower number is better.
// A side carrying a parser name that appears on the list ranks at that
// parser's entry alone, because its details came from the parser — even
// when its collector sits higher. A side with no parser, or whose parser
// appears nowhere on the list, ranks at its collector's entry. Entries
// match only their own kind.
//
// A rank of null means the side appears nowhere in the list, which is a
// different answer from ranking last: two absent sides leave the stored
// value standing, while two sides that tie let the later copy win.
export function sideRank(list: readonly string[], side: PrioritySide): number | null {
  if (side.parser != null) {
    const parserRank = findEntryRank(list, "parser", side.parser);
    if (parserRank !== null) {
      return parserRank;
    }
  }

  if (side.collector != null) {
    return findEntryRank(list, "collector", side.collector);
  }

  return null;
}
