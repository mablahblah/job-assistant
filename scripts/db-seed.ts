// Seeds the pipeline database with the settings and ATS companies collection
// needs. It fills what is absent and overwrites nothing, so running it after a
// schema change adds the new setting and leaves everything else as it was.
import "dotenv/config";
import { createPipelineDb } from "../lib/pipeline-db";

const SETTING_DEFAULTS = {
  search_terms: ["Product Design", "UX", "Founding Design"],
  location: "78701",
  radius: 30,
  expiry_threshold: 8,
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

// A stand-in name built from the slug, which a collector replaces with the
// employer's real name. Separators become spaces and each word gets a capital
// first letter, leaving the rest of the word alone.
function nameFromSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

type PipelineDb = ReturnType<typeof createPipelineDb>;

type SettingPatch = {
  search_terms?: string[];
  location?: string;
  radius?: number;
  expiry_threshold?: number;
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
