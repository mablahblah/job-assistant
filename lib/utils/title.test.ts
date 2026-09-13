import { describe, expect, test } from "vitest";
import fixture from "./ux-titles.fixture.json";
import { normalizeTitle, type TitleVocabularies } from "./title";

// The measured defaults from scripts/db-seed.ts's SETTING_DEFAULTS, restated
// so the title tests run against what really ships. A test needing a different
// list spreads this and overrides the one list it cares about, rather than
// restating the whole object. It moves whenever SETTING_DEFAULTS does, as does
// EXPECTED_TITLE_LEVELS in lib/services/settings-service.test.ts.
const VOCABULARIES: TitleVocabularies = {
  headNouns: [
    "analyst", "architect", "artist", "consultant", "coordinator", "copywriter",
    "designer", "developer", "director", "engineer", "head", "lead", "manager",
    "owner", "producer", "programmer", "researcher", "scientist", "specialist",
    "strategist", "technician", "technologist", "translator", "vp", "writer",
  ],
  levels: [
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
  suffixes: ["-er", "-or", "-ist", "-yst", "-ian", "-ant", "-ect"],
  removalWords: ["w2", "c2h", "evergreen"],
};

// Remote is deliberately off the seeded removal list, because a real title
// like "Lead Product Designer, Remote" should keep Remote as its team. The
// two criteria that turn on removal name Remote as their own precondition,
// so they supply it themselves.
const WITH_REMOTE_REMOVED: TitleVocabularies = {
  ...VOCABULARIES,
  removalWords: [...VOCABULARIES.removalWords, "remote"],
};

describe("normalizeTitle: the pattern", () => {
  test("a level and a role assemble into one string", () => {
    expect(normalizeTitle("Senior UX Designer", VOCABULARIES).title).toBe("Sr. UX Designer");
  });

  test("a team segment joins on after a dash", () => {
    expect(normalizeTitle("Staff Product Designer, AI", VOCABULARIES).title).toBe(
      "Staff Product Designer - AI"
    );
  });

  test("the role keeps 'of', with no rule written for that word", () => {
    const result = normalizeTitle("Senior Manager of Design, AI Solutions", VOCABULARIES);
    expect(result.role).toBe("Manager of Design");
    expect(result.team).toBe("AI Solutions");
  });

  test("a level word stays in the role when it is the only head noun", () => {
    // Taking out "Head" would leave "of UX Design", which holds no head noun
    // of its own — "design" is not on the list, only "designer" is.
    const result = normalizeTitle("Head of UX Design", VOCABULARIES);
    expect(result.role).toBe("Head of UX Design");
    expect(result.level).toBeUndefined();
  });
});

describe("normalizeTitle: noise", () => {
  test("a requisition number is gone from the title", () => {
    expect(normalizeTitle("14503 UI/UX Designer", VOCABULARIES).title).toBe("UI/UX Designer");
  });

  test("a removal word is never taken out of the role", () => {
    const result = normalizeTitle("Remote Lead Product Designer", WITH_REMOTE_REMOVED);
    expect(result.level).toBe("Lead");
    expect(result.role).toBe("Remote Product Designer");
  });

  test("a removal word filling a whole team segment leaves no team", () => {
    const result = normalizeTitle("Lead Product Designer, Remote", WITH_REMOTE_REMOVED);
    expect(result.team).toBeUndefined();
  });

  test("a token mixing letters and digits survives", () => {
    expect(normalizeTitle("Product Designer, 3D", VOCABULARIES).team).toBe("3D");
  });

  test("a roman numeral is kept, so two levels of the same role stay apart", () => {
    expect(normalizeTitle("UX Designer II", VOCABULARIES).role).toBe("UX Designer II");
  });

  test("brackets go as punctuation and a gender marker goes by shape", () => {
    expect(normalizeTitle("(Senior) UX/UI Designer (m/w/d)", VOCABULARIES).title).toBe(
      "Sr. UX/UI Designer"
    );
  });

  test("a slashed token with a multi-letter part is not a gender marker", () => {
    expect(normalizeTitle("UX/UI Designer", VOCABULARIES).role).toBe("UX/UI Designer");
    expect(normalizeTitle("TS/SCI Designer", VOCABULARIES).role).toBe("TS/SCI Designer");
  });
});

describe("normalizeTitle: punctuation", () => {
  test("a colon is punctuation and goes", () => {
    const result = normalizeTitle("Senior UX Designer - Blight: Survival", VOCABULARIES);
    expect(result.team).toBe("Blight Survival");
  });

  test("a full stop goes without changing what the level stores", () => {
    // "Sr." tidies to "Sr", which the level list still matches, and the
    // stored spelling is what puts the full stop back.
    const result = normalizeTitle("Sr. Product Designer", VOCABULARIES);
    expect(result.level).toBe("Sr.");
    expect(result.role).toBe("Product Designer");
  });

  test("a hash, an underscore and a middle dot are content and stay", () => {
    // Only the nine listed punctuation characters go. Everything else is
    // part of a real word — a language name, a system name, a French noun.
    expect(normalizeTitle("Developer - C#/WPF Tooling", VOCABULARIES).team).toBe("C#/WPF Tooling");
    expect(normalizeTitle("Developer - UI/UX_Workflow", VOCABULARIES).team).toBe("UI/UX_Workflow");
    expect(normalizeTitle("UX Director - Concepteur·trice", VOCABULARIES).team).toBe(
      "Concepteur·trice"
    );
  });

  test("a bracket is replaced by a space rather than deleted", () => {
    // Without the space, "Designer(6" welds into "Designer6" and the digit
    // can no longer be dropped as a lone number token.
    const result = normalizeTitle("UI/UX Designer(6 months Contract)", VOCABULARIES);
    expect(result.role).toBe("UI/UX Designer months Contract");
    expect(result.matched).toBe(true);
  });

  test("a colon is replaced by a space on the same grounds", () => {
    const result = normalizeTitle("Product Designer:in (UX/UI)", VOCABULARIES);
    expect(result.role).toBe("Product Designer in UX/UI");
    expect(result.matched).toBe(true);
  });

  test("a full stop is deleted outright rather than spaced", () => {
    // Inside a word a full stop abbreviates and never separates. Deleting it
    // lets "U.S." collapse to "US", and is what keeps "Sr." tidying to "Sr".
    expect(normalizeTitle("U.S. UI/UX Designer", VOCABULARIES).role).toBe("US UI/UX Designer");
  });
});

describe("normalizeTitle: dash as a separator", () => {
  test("a dash with a space on one side still separates the team", () => {
    const result = normalizeTitle("UX/UI Designer- REMOTE", VOCABULARIES);
    expect(result.role).toBe("UX/UI Designer");
    expect(result.team).toBe("REMOTE");
  });

  test("a dash glued on both sides is word-internal and falls back", () => {
    // Same rule that keeps "AI-Enabled" and "Front-End" whole: no space on
    // either side of the dash means it is content, not a separator.
    const raw = "UX Designer-Healthcare";
    const result = normalizeTitle(raw, VOCABULARIES);
    expect(result.matched).toBe(false);
    expect(result.title).toBe(raw);
  });
});

describe("normalizeTitle: levels", () => {
  test("a single level word is taken out of the role", () => {
    const result = normalizeTitle("Lead Designer", VOCABULARIES);
    expect(result.level).toBe("Lead");
    expect(result.role).toBe("Designer");
  });

  test("a level run is kept when no head noun survives without it", () => {
    // "Director" is both a level word and the only head noun here. Taking it
    // out leaves "Design", which is not on the list.
    const result = normalizeTitle("Design Director", VOCABULARIES);
    expect(result.role).toBe("Design Director");
    expect(result.level).toBeUndefined();
  });

  test("the level is the whole contiguous run, not one word of it", () => {
    expect(normalizeTitle("Senior Staff UX Researcher", VOCABULARIES).level).toBe("Sr. Staff");
  });

  test("a level run trailing the role is still found", () => {
    const result = normalizeTitle("UI/UX Designer Sr. Principal", VOCABULARIES);
    expect(result.level).toBe("Sr. Principal");
    expect(result.role).toBe("UI/UX Designer");
  });

  test("a level word outside the role segment is still recognised", () => {
    const result = normalizeTitle("VP, UX Creative Director", VOCABULARIES);
    expect(result.level).toBe("VP");
    expect(result.role).toBe("UX Creative Director");
  });

  test("a segment that is not purely seniority stays team", () => {
    const result = normalizeTitle("Director, Associate UX - Revenue Strategy", VOCABULARIES);
    expect(result.level).toBeUndefined();
    expect(result.role).toBe("Director");
    expect(result.team).toBe("Associate UX, Revenue Strategy");
  });

  test("Sr, Sr. and Senior all store the same title", () => {
    const titles = ["Sr UX Designer", "Sr. UX Designer", "Senior UX Designer"].map(
      (raw) => normalizeTitle(raw, VOCABULARIES).title
    );
    expect(new Set(titles).size).toBe(1);
  });

  test("two runs of level words in one segment: the first is the level", () => {
    // "Senior" and "Director" are both level words with a real word between
    // them. The trailing one is the job, so it stays in the role.
    const result = normalizeTitle("Senior Technical Director - AI UX", VOCABULARIES);
    expect(result.level).toBe("Sr.");
    expect(result.role).toBe("Technical Director");
    expect(result.team).toBe("AI UX");
  });

  test("two runs: the trailing level word stays when it is the job noun", () => {
    const result = normalizeTitle("Senior UX/UI Design Lead", VOCABULARIES);
    expect(result.level).toBe("Sr.");
    expect(result.role).toBe("UX/UI Design Lead");
  });
});

describe("normalizeTitle: multi-word levels", () => {
  test("a level's match list holds phrases as well as single words", () => {
    const result = normalizeTitle("Entry Level UX Designer", VOCABULARIES);
    expect(result.level).toBe("Entry-Level");
    expect(result.role).toBe("UX Designer");
  });

  test("the hyphenated spelling sits on the match list beside the two-word one", () => {
    const result = normalizeTitle("Entry-Level UX Designer", VOCABULARIES);
    expect(result.level).toBe("Entry-Level");
    expect(result.role).toBe("UX Designer");
  });

  test("two words spelling one level are matched ahead of the single word that starts them", () => {
    const result = normalizeTitle("Mid Level Product Designer", VOCABULARIES);
    expect(result.level).toBe("Mid-Level");
    expect(result.role).toBe("Product Designer");
  });

  test("the bare word stores the same level as its two-word spelling", () => {
    const result = normalizeTitle("Mid Product Designer", VOCABULARIES);
    expect(result.level).toBe("Mid-Level");
    expect(result.role).toBe("Product Designer");
  });
});

describe("normalizeTitle: head nouns", () => {
  test("the role is the last segment holding a head noun", () => {
    const result = normalizeTitle("Artificial Intelligence - Principal UX Designer", VOCABULARIES);
    expect(result.level).toBe("Principal");
    expect(result.role).toBe("UX Designer");
    expect(result.team).toBe("Artificial Intelligence");
  });

  test("a profession off the closed list is caught by an agent-noun suffix", () => {
    // The precondition this criterion names: no "electrician" on the list, so
    // only the "-ian" suffix can be doing the matching.
    expect(VOCABULARIES.headNouns).not.toContain("electrician");
    const result = normalizeTitle("Senior Electrician", VOCABULARIES);
    expect(result.level).toBe("Sr.");
    expect(result.role).toBe("Electrician");
  });

  test("a closed-list match outranks a suffix match in a later segment", () => {
    // "US" rides along in the role because nothing removes country codes —
    // there is no list for them, on purpose.
    const result = normalizeTitle("(US) Senior UX Designer - (Senior Care)", VOCABULARIES);
    expect(result.level).toBe("Sr.");
    expect(result.role).toBe("US UX Designer");
    expect(result.team).toBe("Senior Care");
  });

  test("a suffix match does not steal the role from a closed-list match", () => {
    // "Contractor" ends in "-or" and would match the suffix net on its own.
    const result = normalizeTitle("UX Designer, Contractor", VOCABULARIES);
    expect(result.role).toBe("UX Designer");
    expect(result.team).toBe("Contractor");
  });

  test("Senior and Junior are never head nouns despite ending in -or", () => {
    expect(normalizeTitle("Senior", VOCABULARIES).role).toBeUndefined();
    expect(normalizeTitle("Junior", VOCABULARIES).role).toBeUndefined();
  });

  test("a level word that cannot be safely removed keeps the role whole", () => {
    // "Head" is both a level word and the head noun. Taking it out leaves
    // "Chef", which matches nothing.
    const result = normalizeTitle("Head Chef", VOCABULARIES);
    expect(result.role).toBe("Head Chef");
    expect(result.level).toBeUndefined();
  });
});

describe("normalizeTitle: team", () => {
  test("a whole segment is the role and produces no team", () => {
    const result = normalizeTitle("Android Development Engineer with UX", VOCABULARIES);
    expect(result.role).toBe("Android Development Engineer with UX");
    expect(result.team).toBeUndefined();
  });

  test("the same team segments in a different order give the same title", () => {
    const first = normalizeTitle("Lead Product Designer - AI, Platform", VOCABULARIES).title;
    const second = normalizeTitle("Lead Product Designer - Platform, AI", VOCABULARIES).title;
    expect(first).toBe(second);
  });

  test("pure structural junk falls back to the untouched raw title", () => {
    // Every token here is a digit-only requisition number or a single-letter
    // slashed marker, so tidying leaves nothing to build a title from.
    const raw = "14503 (m/w/d)";
    const result = normalizeTitle(raw, VOCABULARIES);
    expect(result.title).toBe(raw);
    expect(result.matched).toBe(false);
  });

  test("a title of removal words alone still lands somewhere non-empty", () => {
    // NOTE: step 6 removes words from team segments only, and a title with no
    // head noun never reaches team assembly. So removal words are never
    // actually stripped on this path. This asserts only what the criterion
    // states plainly — the title is never left empty.
    const result = normalizeTitle("W2, C2H, Evergreen", VOCABULARIES);
    expect(result.title).not.toBe("");
    expect(result.matched).toBe(false);
  });

  test("an ampersand inside a team item is not a separator", () => {
    const result = normalizeTitle("Sr. Manager - Inspire & Motivate", VOCABULARIES);
    expect(result.team).toBe("Inspire & Motivate");
  });
});

describe("normalizeTitle: fallback and absence", () => {
  test("no head noun anywhere keeps the tidied string and reports unmatched", () => {
    const result = normalizeTitle("UI/UX", VOCABULARIES);
    expect(result.title).toBe("UI/UX");
    expect(result.matched).toBe(false);
  });

  test("an empty string produces an unmatched result rather than a spurious title", () => {
    expect(normalizeTitle("", VOCABULARIES).matched).toBe(false);
  });

  // ACs 30, 31 and 32 belong to the service that calls this function, not to
  // the function itself. They say a job is never dropped, and that a raw
  // title which is a missing key or null leaves the stored title untouched
  // with no event written. This signature takes a plain string and returns a
  // result, so it has no job to drop and no event to write. They are covered
  // by the normalizer service in task 9.
});

describe("normalizeTitle: compounds and stray levels", () => {
  test("an ampersand joining two role nouns keeps them one role", () => {
    const result = normalizeTitle("Sr. UI/UX Designer & Developer", VOCABULARIES);
    expect(result.level).toBe("Sr.");
    expect(result.role).toBe("UI/UX Designer & Developer");
    expect(result.team).toBeUndefined();
  });

  test("'and' joining two role nouns keeps them one role", () => {
    const result = normalizeTitle("Senior UX Researcher and Designer", VOCABULARIES);
    expect(result.level).toBe("Sr.");
    expect(result.role).toBe("UX Researcher and Designer");
  });

  test("two team segments join alphabetically", () => {
    const result = normalizeTitle(
      "Director, UX Design - Revenue Cycle & AI-Enabled Reimbursement",
      VOCABULARIES
    );
    expect(result.team).toBe("Revenue Cycle & AI-Enabled Reimbursement, UX Design");
  });

  test("a segment holding only a level word is the level, not the role", () => {
    const result = normalizeTitle("UX Product Designer - Aladdin Design, Director", VOCABULARIES);
    expect(result.level).toBe("Director");
    expect(result.role).toBe("UX Product Designer");
    expect(result.team).toBe("Aladdin Design");
  });
});

describe("normalizeTitle: the full test suite", () => {
  test("one title carrying every effect the rule can have on a role", () => {
    // Brackets go as punctuation. 14503 goes as digits alone. m/w/d goes as
    // single letters joined by slashes. UX/UI stays because a slashed token
    // with a multi-letter part is not a gender marker. W2 stays because it
    // mixes letters and digits. II stays because roman numerals mark rank.
    // Artificial Intelligence holds no job noun, so the role comes from the
    // second segment. Senior Staff comes out as one run because Designer
    // survives without it. US and W2 stay put — nothing is cut from a role,
    // and a removal word only ever leaves a team segment.
    const result = normalizeTitle(
      "Artificial Intelligence - (US) 14503 Senior Staff W2 UX/UI Designer II (m/w/d)",
      VOCABULARIES
    );
    expect(result.level).toBe("Sr. Staff");
    expect(result.role).toBe("US W2 UX/UI Designer II");
    expect(result.team).toBe("Artificial Intelligence");
    expect(result.title).toBe("Sr. Staff US W2 UX/UI Designer II - Artificial Intelligence");
  });
});

describe("normalizeTitle: vocabularies as a plain object", () => {
  test("a hand-built vocabulary is enough, with no database in sight", () => {
    const vocabularies: TitleVocabularies = {
      headNouns: ["designer"],
      levels: [{ store: "Sr.", match: ["senior"] }],
      suffixes: [],
      removalWords: [],
    };
    expect(normalizeTitle("Senior Designer", vocabularies).title).toBe("Sr. Designer");
  });
});

describe("normalizeTitle: the committed titles fixture", () => {
  test("every fixture title prints its before and after and lands somewhere", () => {
    // Printed for a person to read. Coverage here is judged by reading the
    // pairs, never scored against a target.
    const titles = [...fixture.ux_as_word, ...fixture.ux_inside_a_word];
    for (const raw of titles) {
      const result = normalizeTitle(raw, VOCABULARIES);
      console.log(`${raw}  =>  ${result.title}`);
      expect(result.title).not.toBe("");
    }
  });
});
