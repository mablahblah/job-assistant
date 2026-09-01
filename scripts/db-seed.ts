// Seeds the pipeline database with the settings and ATS companies collection
// needs. It fills what is absent and overwrites nothing, so running it after a
// schema change adds the new setting and leaves everything else as it was.
import "dotenv/config";
import { createPipelineDb } from "../lib/pipeline-db";
import { nameFromSlug } from "../lib/ats-slug-name";

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
  // might write for it.
  title_levels: [
    { store: "Intern", match: ["intern"] },
    { store: "Entry-Level", match: ["entry level", "entry-level"] },
    { store: "Jr.", match: ["junior", "jr", "jr."] },
    { store: "Associate", match: ["associate", "assoc"] },
    { store: "Mid", match: ["mid"] },
    { store: "Mid-Level", match: ["mid level", "mid-level"] },
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

async function seedCompanies(prisma: PipelineDb): Promise<void> {
  let created = 0;
  let present = 0;

  for (const [ats_platform, slugs] of Object.entries(SLUGS_BY_PLATFORM)) {
    for (const ats_slug of slugs) {
      const existing = await prisma.company.findFirst({
        where: { ats_platform, ats_slug },
      });
      if (existing) {
        present += 1;
        continue;
      }
      await prisma.company.create({
        data: { name: nameFromSlug(ats_slug), ats_platform, ats_slug },
      });
      created += 1;
    }
  }

  console.log(`Companies: created ${created}, already present ${present}`);
}

async function main(): Promise<void> {
  const prisma = createPipelineDb();
  try {
    await seedSettings(prisma);
    await seedCompanies(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
