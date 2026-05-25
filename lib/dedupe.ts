// Parser fidelity ranking — lower number = higher quality results.
// When adding a new parser, slot it in by result quality.
export const PARSER_PRIORITY: Record<string, number> = {
  greenhouse: 1,
  lever: 2,
  ashby: 3,
  dribbble: 4,
  adzuna: 5,
};

// Fallback priority for null (no parser) or unrecognized parser names
const DEFAULT_PRIORITY = 6;

// Returns the priority rank for a parser name. Lower = better.
export function getParserPriority(parser: string | null): number {
  if (parser === null) return DEFAULT_PRIORITY;
  return PARSER_PRIORITY[parser] ?? DEFAULT_PRIORITY;
}

export interface UrlDedupeResult<T> {
  kept: T[];
  droppedBatchDupes: number;
  droppedDbMatches: number;
}

// Dedupes a list by URL: removes within-batch duplicates (keeps first),
// then removes items whose URL exists in the known DB set.
// The accessor function extracts the URL to compare from each item.
export function dedupeByUrl<T>(
  items: T[],
  accessor: (item: T) => string | null | undefined,
  knownDbUrls: Set<string>,
): UrlDedupeResult<T> {
  let droppedBatchDupes = 0;
  let droppedDbMatches = 0;

  // Pass 1: remove within-batch duplicates
  const seen = new Set<string>();
  const batchUnique: T[] = [];
  for (const item of items) {
    const url = accessor(item);
    if (url == null) {
      batchUnique.push(item);
      continue;
    }
    if (seen.has(url)) {
      droppedBatchDupes++;
      continue;
    }
    seen.add(url);
    batchUnique.push(item);
  }

  // Pass 2: remove items found in DB
  const kept: T[] = [];
  for (const item of batchUnique) {
    const url = accessor(item);
    if (url != null && knownDbUrls.has(url)) {
      droppedDbMatches++;
      continue;
    }
    kept.push(item);
  }

  return { kept, droppedBatchDupes, droppedDbMatches };
}

// --- Content-based dedupe (Dedupe 3) ---

// Statuses safe to replace when a content match is found
const REPLACEABLE_STATUSES = new Set(["backlog", "too far", "expired", "won't apply", "rejected"]);

// A batch item going through content dedupe — matches SaveableJob shape
export interface ContentDedupeItem {
  url: string;
  title: string;
  companyName: string;
  location: string;
  workMode: string;
  postedAt: string;
  salaryRange: string;
  source: string;
  parser: string | null;
  originalUrl: string | null;
  repost?: boolean;
}

// Minimal DB job info needed for content comparison
export interface DbJobForDedupe {
  id: string;
  title: string;
  companyName: string;
  parser: string | null;
  postedAt: string;
  status: string;
  location?: string;
  workMode?: string;
  salaryRange?: string;
}

// Instructions to update an existing DB record with winning data
export interface DbUpdate {
  id: string;
  repost: boolean;
  data: Partial<ContentDedupeItem>;
}

export interface ContentDedupeResult {
  kept: ContentDedupeItem[];
  dbUpdates: DbUpdate[];
  droppedBatchDupes: number;
  droppedByDb: number;
}

// Mergeable fields — winner takes loser's value when winner's is empty
const MERGEABLE_FIELDS = ["location", "workMode", "salaryRange", "postedAt"] as const;

// Returns true if a field value counts as "has data"
function hasValue(val: string | undefined | null): boolean {
  return val != null && val !== "" && val !== "?";
}

// Merges empty fields from loser into winner. Mutates winner in place.
function mergeFields(winner: ContentDedupeItem, loser: Partial<Record<string, string>>): void {
  for (const field of MERGEABLE_FIELDS) {
    if (!hasValue(winner[field]) && hasValue(loser[field])) {
      (winner as Record<string, unknown>)[field] = loser[field];
    }
  }
}

// Content-based dedupe: matches by title+company, resolves conflicts with
// the priority cascade, and merges empty fields from the loser.
// Handles both within-batch and against-DB comparisons.
export function dedupeByContent(
  items: ContentDedupeItem[],
  dbJobs: DbJobForDedupe[],
): ContentDedupeResult {
  let droppedBatchDupes = 0;
  let droppedByDb = 0;
  const dbUpdates: DbUpdate[] = [];

  // Group batch items by title+company (case-sensitive, same as current logic)
  const groups = new Map<string, ContentDedupeItem[]>();
  for (const item of items) {
    const key = `${item.companyName}\0${item.title}`;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }

  // Within-batch: reduce each group to a single winner
  const batchWinners: ContentDedupeItem[] = [];
  for (const [, group] of groups) {
    if (group.length === 1) {
      batchWinners.push(group[0]);
      continue;
    }

    // Sort by priority (ascending), then by date (descending) to pick the best
    const sorted = [...group].sort((a, b) => {
      const priDiff = getParserPriority(a.parser) - getParserPriority(b.parser);
      if (priDiff !== 0) return priDiff;
      return b.postedAt.localeCompare(a.postedAt);
    });

    const winner = { ...sorted[0] };
    const losers = sorted.slice(1);

    // Check if this is a repost (same parser, different date)
    const winnerPri = getParserPriority(winner.parser);
    for (const loser of losers) {
      const loserPri = getParserPriority(loser.parser);
      if (winnerPri === loserPri && winner.postedAt !== loser.postedAt) {
        winner.repost = true;
      }
      mergeFields(winner, loser);
    }

    droppedBatchDupes += losers.length;
    batchWinners.push(winner);
  }

  // Against DB: compare each batch winner with existing DB records
  const dbIndex = new Map<string, DbJobForDedupe>();
  for (const dbJob of dbJobs) {
    const key = `${dbJob.companyName}\0${dbJob.title}`;
    dbIndex.set(key, dbJob);
  }

  const kept: ContentDedupeItem[] = [];
  for (const item of batchWinners) {
    const key = `${item.companyName}\0${item.title}`;
    const dbMatch = dbIndex.get(key);

    if (!dbMatch) {
      kept.push(item);
      continue;
    }

    // Active job — never touch it, drop the batch item
    if (!REPLACEABLE_STATUSES.has(dbMatch.status)) {
      droppedByDb++;
      continue;
    }

    const itemPri = getParserPriority(item.parser);
    const dbPri = getParserPriority(dbMatch.parser);

    // Priority cascade: better parser wins, then newer date, then existing wins
    let batchWins = false;
    let isRepost = false;

    if (itemPri !== dbPri) {
      batchWins = itemPri < dbPri;
    } else if (item.postedAt !== dbMatch.postedAt) {
      batchWins = item.postedAt > dbMatch.postedAt;
      isRepost = true;
    }
    // Same priority, same date — DB record wins (drop batch item)

    if (batchWins) {
      // Merge empty fields from DB record into batch winner
      mergeFields(item, dbMatch);
      if (isRepost) item.repost = true;

      // Build the update payload (companyName excluded — it's a relation, not a Job field,
      // and can't change since content dedupe matches by company+title)
      const updateData: Partial<ContentDedupeItem> = {
        url: item.url,
        title: item.title,
        source: item.source,
        parser: item.parser,
        originalUrl: item.originalUrl,
      };
      for (const field of MERGEABLE_FIELDS) {
        if (hasValue(item[field])) {
          (updateData as Record<string, unknown>)[field] = item[field];
        }
      }

      dbUpdates.push({
        id: dbMatch.id,
        repost: item.repost ?? isRepost,
        data: updateData,
      });
      // Don't add to kept — this updates an existing record, not a new insert
    } else {
      droppedByDb++;
    }
  }

  return { kept, dbUpdates, droppedBatchDupes, droppedByDb };
}
