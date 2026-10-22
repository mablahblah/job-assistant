// The values a fresh settings row starts with. The seed fills any setting
// still empty from here, and the settings stand-in answers with the same
// values, so the two cannot drift apart.

const STARTING_TOWNS = [
  "Austin, Texas, United States",
  "Round Rock, Texas, United States",
  "Cedar Park, Texas, United States",
  "Pflugerville, Texas, United States",
  "Georgetown, Texas, United States",
  "Leander, Texas, United States",
  "Kyle, Texas, United States",
  "Buda, Texas, United States",
  "San Marcos, Texas, United States",
  "Hutto, Texas, United States",
  "Manor, Texas, United States",
  "Lakeway, Texas, United States",
  "Bee Cave, Texas, United States",
  "Dripping Springs, Texas, United States",
  "Taylor, Texas, United States",
  "Bastrop, Texas, United States",
];

export const SETTING_DEFAULTS = {
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
  // Austin-area towns for the Fantastic.jobs paid search; written in full so
  // towns in any state can be added without a code change; does not follow the
  // radius setting.
  search_towns: STARTING_TOWNS,
  // Remote labels for the Fantastic.jobs paid search.
  remote_labels: ["Remote OK", "Remote Solely"],
  // Title terms to skip; the collector adds its own wildcards.
  excluded_titles: [
    "Engineer",
    "Engineering",
    "Research",
    "Researcher",
    "Associate",
    "Junior",
    "Jr",
    "Intern",
    "Internship",
    "Director",
    "Head",
    "VP",
    "Manager",
  ],
  // Days back to search; the service offers 1 or 7.
  search_window_days: 7,
  // UltiPro carries a job's only identity in opportunityid; some employers'
  // hiring systems carry it in reqId or gh_jid; every other query value is
  // dropped.
  identifying_query_values: ["opportunityid", "reqId", "gh_jid"],
};
