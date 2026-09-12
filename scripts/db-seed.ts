// Seeds the pipeline database with the settings and ATS companies collection
// needs. It fills what is absent and overwrites nothing, so running it after a
// schema change adds the new setting and leaves everything else as it was.
import { createPipelineDb } from "../lib/pipeline-db";
import { createCompanyService, type CompanyService } from "../lib/company-service";
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
  // with it: EXPECTED_TITLE_LEVELS in lib/settings-service.test.ts, which has
  // to stay an independent copy to prove the round trip through the database,
  // and VOCABULARIES in lib/title.test.ts, which mirrors it so the title tests
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
  resolution_concurrency: 3,
};

// The boards each ATS collector polls. A collector finds its work by asking
// for the companies carrying its platform and a slug.
const SLUGS_BY_PLATFORM: Record<string, string[]> = {
  greenhouse: [
    "gitlab",
    "duolingo",
    "stripe",
    "asana",
    "lyft",
    "dropbox",
    "squarespace",
    "hellofresh",
    "intercom",
    "coursera",
    "modernhealth",
    "calm",
    "figma",
  ],
  lever: ["gohighlevel", "USMobile", "bhvr"],
  ashby: ["hinge-health", "legora", "bjakcareer", "voodoo", "scorewarrior"],
};

// The full ranking a database should end up holding. It sits apart from
// SETTING_DEFAULTS because it is not filled when null and left alone after:
// this list is read while it holds the user's own ordering and appended to.
//
// The ranking is written out by hand rather than derived from the registries,
// because it is a judgment about which source tells the truth while the
// registries are ordered by when each source was built.
//
// collector:user is not in either registry. It is a fixed entry standing for
// a job the user typed in by hand, and it leads because that is the one
// source nothing automated should be allowed to overwrite.
//
// Every parser follows, because a parser read the employer's own posting.
// Then the collectors that read an employer's own board, and last the two
// aggregators, which carry someone else's copy of a posting rather than the
// posting itself.
const RANKED_SOURCES: string[] = [
  "collector:user",
  "parser:greenhouse",
  "parser:lever",
  "parser:ashby",
  "parser:dribbble",
  "collector:greenhouse",
  "collector:lever",
  "collector:ashby",
  "collector:dribbble",
  "collector:uiuxjobsboard",
  "collector:adzuna",
  "collector:jsearch",
];

// Whatever a registry holds that the ranking above does not name. A source
// added to a registry and forgotten here still gets an entry rather than
// silently ranking nowhere, and it joins at the bottom, which is where an
// unplaced source belongs. The parser registry is keyed by owned domain, so
// one parser could in principle be reached by two domains; the names are
// deduplicated.
const UNRANKED_SOURCES: string[] = [
  ...Array.from(new Set(Object.values(PARSERS_BY_DOMAIN).map((parser) => parser.name))).map(
    (name) => `parser:${name}`
  ),
  ...COLLECTORS.map((collector) => `collector:${collector.name}`),
].filter((name) => !RANKED_SOURCES.includes(name));

const SOURCE_PRIORITY_DEFAULTS: string[] = [...RANKED_SOURCES, ...UNRANKED_SOURCES];

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
  resolution_concurrency?: number;
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
  if (existing.resolution_concurrency === null) {
    patch.resolution_concurrency = SETTING_DEFAULTS.resolution_concurrency;
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

async function seedCompanies(companyService: CompanyService): Promise<void> {
  let created = 0;
  let present = 0;
  // Each clash gets a line of its own. A slug held by the wrong board is a
  // fact about two specific rows, and a count would hide which ones.
  const warnings: string[] = [];

  for (const [ats_platform, slugs] of Object.entries(SLUGS_BY_PLATFORM)) {
    for (const ats_slug of slugs) {
      // A slug is unique across the whole table, so the lookup goes by slug
      // alone. A hit under a different platform means another board already
      // claimed it, rather than that this board owns the row.
      const existing = await companyService.findBySlug(ats_slug);

      if (existing) {
        if (existing.ats_platform === ats_platform) {
          present += 1;
        } else {
          warnings.push(
            `Warning: slug "${ats_slug}" for ${ats_platform} is already ` +
              `held by ${existing.ats_platform}. Skipped.`
          );
        }
        continue;
      }

      // Seeded with no name on purpose. Nothing invents a company name from
      // a board slug; company association fills it from the first job that
      // supplies a real one.
      const result = await companyService.create({ ats_platform, ats_slug });
      if (result.created) {
        created += 1;
      } else {
        // The service caught a refused write and handed back the company
        // blocking it, rather than throwing. Only a second seed running at
        // the same time can reach this.
        warnings.push(
          `Warning: could not create the company for slug "${ats_slug}" ` +
            `because another company already holds it. Skipped.`
        );
      }
    }
  }

  console.log(`Companies: created ${created}, already present ${present}`);
  for (const warning of warnings) {
    console.log(warning);
  }
}

async function main(): Promise<void> {
  const prisma = createPipelineDb();
  try {
    await seedSettings(prisma);
    // After seedSettings, which is what creates the row when it is absent.
    await seedSourcePriority(prisma);
    await seedCompanies(createCompanyService(prisma));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
