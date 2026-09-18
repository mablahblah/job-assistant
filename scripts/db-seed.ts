// Seeds the pipeline database with the settings collection needs. It fills
// what is absent and overwrites nothing, so running it after a schema change
// adds the new setting and leaves everything else as it was. It creates no
// board rows and marks nothing as polled: polling is earned by promotion
// alone, and a slug list here would re-arm the boards on every reseed.
import { createPipelineDb } from "../lib/db/pipeline-db";
import { COLLECTORS } from "../lib/collectors/registry";
import { PARSERS_BY_DOMAIN } from "../lib/parsers/registry";

const SETTING_DEFAULTS = {
  search_terms: ["Product Design", "UX", "Founding Design"],
  location: "78701",
  radius: 30,
  expiry_threshold: 8,
  // The words that name a job. Finding one is what tells the title rule which
  // part of a title is the role.
  title_head_nouns: [
    "analyst", "architect", "artist", "consultant", "coordinator", "copywriter",
    "designer", "developer", "director", "engineer", "head", "lead", "manager",
    "owner", "producer", "programmer", "researcher", "scientist", "specialist",
    "strategist", "technician", "technologist", "translator", "vp", "writer",
  ],
  // Each seniority spelling that gets stored, with every spelling a posting
  // might write for it. This is the real list — two tests restate it and move
  // with it: EXPECTED_TITLE_LEVELS in lib/services/settings-service.test.ts, which has
  // to stay an independent copy to prove the round trip through the database,
  // and VOCABULARIES in lib/utils/title.test.ts, which mirrors it so the title tests
  // run against what really ships.
  title_levels: [
    { store: "Intern", match: ["intern"] },
    { store: "Entry-Level", match: ["entry level", "entry-level"] },
    { store: "Jr.", match: ["junior", "jr", "jr."] },
    { store: "Associate", match: ["associate", "assoc"] },
    { store: "Mid-Level", match: ["mid level", "mid-level", "mid"] },
    { store: "Sr.", match: ["senior", "sr", "sr."] },
    { store: "Staff", match: ["staff"] },
    { store: "Lead", match: ["lead"] },
    { store: "Principal", match: ["principal"] },
    { store: "Head", match: ["head"] },
    { store: "Director", match: ["director"] },
    { store: "VP", match: ["vp"] },
    { store: "Chief", match: ["chief"] },
  ],
  // Word endings that name a person doing a job, used when no head noun
  // matched so a profession the list has never seen is still recognised.
  title_suffixes: ["-er", "-or", "-ist", "-yst", "-ian", "-ant", "-ect"],
  // Words taken out of a title's team part only. Deliberately short: it grows
  // from what real titles turn out to need rather than from a list fitted in
  // advance.
  title_removal_words: ["w2", "c2h", "evergreen"],
  resolution_fast_concurrency: 3,
  resolution_slow_concurrency: 1,
  resolution_slow_pause_seconds: 12,
  repost_gap_days: 3,
  // A company's four scores must average above this before its board joins a
  // polling list. 3.5 sits just above the middle, so a company that scored a
  // flat 3 everywhere — the value the rubric awards when nothing public was
  // found — is never promoted on guesses alone.
  promotion_threshold: 3.5,
  // How long a company's scores stand before backlog cleanup empties them.
  score_expiry_days: 90,
  // How long a guessed category stands. Shorter than the score expiry,
  // because a guess is a placeholder rather than research.
  guessed_score_expiry_days: 30,
};

// The full ranking a database should end up holding. It sits apart from
// SETTING_DEFAULTS because it is not filled when null and left alone after:
// this list is read while it holds the user's own ordering and appended to.
//
// Every source that must hold an entry, so nothing a run produces ranks
// nowhere. The order here is only where a fresh database starts: the decision
// of 2026-09-06 puts the ordering in the user's hands, and the seed never
// reorders what is already stored.
//
// collector:user is in neither registry. It is a fixed entry standing for a
// job the user typed in by hand.
//
// The parser registry is keyed by owned domain, so one parser could in
// principle be reached by two domains. The names are deduplicated.
const SOURCE_PRIORITY_DEFAULTS: string[] = [
  "collector:user",
  ...Array.from(new Set(Object.values(PARSERS_BY_DOMAIN).map((parser) => parser.name))).map(
    (name) => `parser:${name}`
  ),
  ...COLLECTORS.map((collector) => `collector:${collector.name}`),
];

type PipelineDb = ReturnType<typeof createPipelineDb>;

type TitleLevelDefault = { store: string; match: string[] };

type SettingPatch = {
  search_terms?: string[];
  location?: string;
  radius?: number;
  expiry_threshold?: number;
  title_head_nouns?: string[];
  title_levels?: TitleLevelDefault[];
  title_suffixes?: string[];
  title_removal_words?: string[];
  resolution_fast_concurrency?: number;
  resolution_slow_concurrency?: number;
  resolution_slow_pause_seconds?: number;
  repost_gap_days?: number;
  promotion_threshold?: number;
  score_expiry_days?: number;
  guessed_score_expiry_days?: number;
};

async function seedSettings(prisma: PipelineDb): Promise<void> {
  const existing = await prisma.setting.findUnique({ where: { id: 1 } });

  if (!existing) {
    await prisma.setting.create({ data: { id: 1, ...SETTING_DEFAULTS } });
    console.log("Settings: created the row with every default");
    return;
  }

  // Only the columns sitting at null are filled. Anything holding a value is
  // left alone, because the user may have set it themselves.
  const patch: SettingPatch = {};
  if (existing.search_terms === null) patch.search_terms = SETTING_DEFAULTS.search_terms;
  if (existing.location === null) patch.location = SETTING_DEFAULTS.location;
  if (existing.radius === null) patch.radius = SETTING_DEFAULTS.radius;
  if (existing.expiry_threshold === null) {
    patch.expiry_threshold = SETTING_DEFAULTS.expiry_threshold;
  }
  if (existing.title_head_nouns === null) {
    patch.title_head_nouns = SETTING_DEFAULTS.title_head_nouns;
  }
  if (existing.title_levels === null) patch.title_levels = SETTING_DEFAULTS.title_levels;
  if (existing.title_suffixes === null) patch.title_suffixes = SETTING_DEFAULTS.title_suffixes;
  if (existing.title_removal_words === null) {
    patch.title_removal_words = SETTING_DEFAULTS.title_removal_words;
  }
  if (existing.resolution_fast_concurrency === null) {
    patch.resolution_fast_concurrency = SETTING_DEFAULTS.resolution_fast_concurrency;
  }
  if (existing.resolution_slow_concurrency === null) {
    patch.resolution_slow_concurrency = SETTING_DEFAULTS.resolution_slow_concurrency;
  }
  // Filled when absent like every other setting, and left alone once set,
  // because a pause the user has tuned against a source that pushed back is
  // exactly the kind of value a seed must never overwrite.
  if (existing.resolution_slow_pause_seconds === null) {
    patch.resolution_slow_pause_seconds = SETTING_DEFAULTS.resolution_slow_pause_seconds;
  }
  if (existing.promotion_threshold === null) {
    patch.promotion_threshold = SETTING_DEFAULTS.promotion_threshold;
  }
  if (existing.score_expiry_days === null) {
    patch.score_expiry_days = SETTING_DEFAULTS.score_expiry_days;
  }
  if (existing.guessed_score_expiry_days === null) {
    patch.guessed_score_expiry_days = SETTING_DEFAULTS.guessed_score_expiry_days;
  }
  if (existing.repost_gap_days === null) {
    patch.repost_gap_days = SETTING_DEFAULTS.repost_gap_days;
  }

  const filled = Object.keys(patch);
  if (filled.length === 0) {
    // Skipped rather than written empty, because modified_at moves on any
    // update and a run that changed nothing should not look like it did.
    console.log("Settings: nothing absent, nothing written");
    return;
  }

  await prisma.setting.update({ where: { id: 1 }, data: patch });
  console.log(`Settings: filled ${filled.join(", ")}`);
}

// Appends any source missing from the stored ranking and moves nothing that
// is already there. The user reorders this list by hand, so a seed that
// sorted it would undo their ranking on every run.
async function seedSourcePriority(prisma: PipelineDb): Promise<void> {
  const existing = await prisma.setting.findUnique({ where: { id: 1 } });
  // seedSettings runs first and creates this row, so a missing one means the
  // seed is already failing elsewhere. Skip rather than fail a second time.
  if (existing === null) return;

  // The column is Json, so Prisma hands it back as a value of any shape.
  // Anything that is not a list of strings ranks nothing, which is what an
  // empty list already means, so it is read as one rather than crashing.
  const raw = existing.source_priority_list;
  const stored: string[] =
    Array.isArray(raw) && raw.every((entry) => typeof entry === "string")
      ? (raw as string[])
      : [];

  const missing = SOURCE_PRIORITY_DEFAULTS.filter((name) => !stored.includes(name));

  if (missing.length === 0) {
    // Skipped rather than written unchanged, because modified_at moves on any
    // update and a run that changed nothing should not look like it did.
    console.log("Source priority list: nothing absent, nothing written");
    return;
  }

  // A new source joins at the bottom, ranked below everything the user has
  // already placed, rather than being slotted in on its behalf.
  await prisma.setting.update({
    where: { id: 1 },
    data: { source_priority_list: [...stored, ...missing] },
  });
  console.log(`Source priority list: added ${missing.join(", ")} to the bottom`);
}

async function main(): Promise<void> {
  const prisma = createPipelineDb();
  try {
    await seedSettings(prisma);
    // After seedSettings, which is what creates the row when it is absent.
    await seedSourcePriority(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
