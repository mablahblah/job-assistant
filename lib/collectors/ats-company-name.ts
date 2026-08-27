// An ATS job is collected once and never parsed, so whichever name lands on
// the job here is the name it keeps. Greenhouse, Lever, and Ashby each find
// the real employer name their own way; the fallback and the warning they all
// share when that lookup comes up empty live here.
import { nameFromSlug } from "../ats-slug-name";

export interface AtsCompanyName {
  name: string;
  warnings: string[];
}

// Decoration a board tacks onto the employer's name. Ashby appends " Jobs",
// sometimes with a doubled space; Lever serves the name bare.
const LEADING_DECORATION = /^(careers at|jobs at|working at)\s+/i;
const TRAILING_DECORATION = /\s(jobs|careers|job board|openings)$/i;
const DECORATION_ALONE = /^(jobs|careers)$/i;

// No employer name runs longer than this, so anything past it is a page
// title carrying more than the name.
const LONGEST_PLAUSIBLE_NAME = 60;

// Pulls the text out of a document's <title> tag, attributes and all. A
// document with no title tag has nothing to pull.
export function titleFromHtml(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1] : null;
}

// Reduces a board page title to the bare employer name, or null when what is
// left is not recognisably one.
export function nameFromBoardTitle(title: string): string | null {
  // Whitespace collapses first, so a decoration with a doubled space in front
  // of it still matches.
  let name = title.replace(/\s+/g, " ").trim();

  name = name.replace(LEADING_DECORATION, "");

  // A title that is nothing but "Jobs" names no employer, and has no leading
  // space for the trailing strip to catch.
  if (DECORATION_ALONE.test(name)) {
    name = "";
  } else {
    name = name.replace(TRAILING_DECORATION, "");
  }

  name = name.trim();

  // A title holding a separator lists more than the employer.
  if (name === "" || name.includes("|") || name.length > LONGEST_PLAUSIBLE_NAME) {
    return null;
  }

  return name;
}

// Asks lookUp for the employer's real name exactly once. Whether it finds
// nothing or throws outright, the slug-built stand-in is used instead and one
// warning records what happened, so a name that could not be fetched never
// costs the whole board its jobs.
export async function resolveAtsCompanyName(
  platform: string,
  slug: string,
  lookUp: () => Promise<string | null>
): Promise<AtsCompanyName> {
  let name: string | null;
  let failure: string | null = null;

  try {
    name = await lookUp();
  } catch (error) {
    name = null;
    failure = error instanceof Error ? error.message : String(error);
  }

  if (name !== null) {
    return { name, warnings: [] };
  }

  const reason = failure ?? "no name was found";
  return {
    name: nameFromSlug(slug),
    warnings: [
      `Could not resolve a name for ${platform} board "${slug}" (${reason}); used the slug-built name instead.`,
    ],
  };
}
