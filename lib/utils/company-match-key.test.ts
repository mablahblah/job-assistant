import { describe, expect, test } from "vitest";
import { companyMatchKey } from "./company-match-key";
import { normalizeCompanyName } from "./company-name";
import fixture from "./company-names.fixture.json";

// The names the key deliberately merges, recorded from the measured run over
// the fixture. A rule change that merges anything new fails this test rather
// than passing quietly.
const EXPECTED_MERGE_GROUPS: [string, string[]][] = [
  ["ablefy", ["ablefy", "ablefy GmbH"]],
  ["amazon", ["AMAZON", "Amazon"]],
  ["apple", ["Apple", "Apple, Inc."]],
  ["bcore", ["B/Core", "bcore"]],
  ["bdrsolutions", ["BDR Solutions", "BDR Solutions LLC"]],
  ["biotunepharmaceuticalresearch", ["Biotune Pharmaceutical Research", "Biotune Pharmaceutical research"]],
  ["bjak", ["Bjak", "Bjak "]],
  ["caterpillar", ["Caterpillar", "Caterpillar, Inc."]],
  ["chimefinancial", ["Chime Financial", "Chime Financial, Inc"]],
  ["cloudious", ["Cloudious", "Cloudious LLC"]],
  ["conchtechnologies", ["Conch Technologies", "Conch Technologies Inc"]],
  ["cynetsystems", ["CYNET SYSTEMS", "Cynet Systems"]],
  ["donatotechnologies", ["Donato Technologies Inc", "Donato Technologies, Inc"]],
  ["elderresearch", ["Elder Research", "Elder Research, Inc."]],
  ["fordmotor", ["Ford Motor", "Ford Motor Company"]],
  ["fortive", ["Fortive", "Fortive Corporation"]],
  ["gusto", ["Gusto", "Gusto, Inc."]],
  ["hewlettpackardenterprise", ["Hewlett Packard Enterprise", "Hewlett Packard Enterprise Company"]],
  ["highlevel", ["HighLevel", "HighLevel, Inc"]],
  ["hp", ["HP", "HP Inc."]],
  ["icsi", ["ICSI.", "Icsi."]],
  ["imrsoft", ["IMR Soft LLC", "IMR Soft Llc"]],
  ["innovance", ["Innovance", "Innovance, Inc."]],
  ["integrationinnovation", ["Integration Innovation, Inc.", "Integration Innovation, Inc. "]],
  ["legora", ["Legora", "Legora AB"]],
  ["maximus", ["Maximus", "Maximus, Inc."]],
  ["microsoft", ["Microsoft", "Microsoft Corporation"]],
  ["nttdataamericas", ["NTT DATA Americas, Inc.", "NTT Data Americas, Inc."]],
  ["ocrolus", ["Ocrolus", "Ocrolus Inc."]],
  ["parsons", ["Parsons", "Parsons Corporation"]],
  ["peopleforceconsulting", ["PEOPLE FORCE CONSULTING INC", "People Force Consulting Inc"]],
  ["petscreening", ["Pet Screening", "PetScreening"]],
  ["plaid", ["Plaid", "Plaid Inc"]],
  ["pyramidconsulting", ["Pyramid Consulting, Inc", "Pyramid Consulting, Inc."]],
  ["rtx", ["RTX", "RTX Corporation"]],
  ["rwazi", ["Rwazi", "Rwazi, Inc."]],
  ["ryanspecialty", ["Ryan Specialty", "Ryan Specialty Group"]],
  ["sandisk", ["SanDisk", "Sandisk"]],
  ["skygrid", ["SkyGrid", "SkyGrid, LLC"]],
  ["steame", ["STEAMe", "STEAMe LLC"]],
  ["synertex", ["Synertex", "Synertex LLC"]],
  ["titantechnologies", ["Titan Technologies", "Titan Technologies, LLC"]],
  ["verndale", ["Verndale", "Verndale LLC"]],
  ["very", ["Very", "Very LLC"]],
];

describe("AC 7: every character that is not a letter or a digit is removed and the rest is lowercased", () => {
  test("punctuation between words is stripped and case is dropped", () => {
    // '&' is neither a letter nor a digit, so it becomes a word boundary and
    // then disappears entirely from the joined key.
    expect(companyMatchKey("AT&T")).toBe("att");
  });

  test("digits survive stripping alongside letters", () => {
    expect(companyMatchKey("7-Eleven")).toBe("7eleven");
  });
});

describe("AC 8: a trailing legal-entity word, or a trailing run of them, is dropped", () => {
  test("a single trailing legal-entity word is dropped", () => {
    expect(companyMatchKey("Acme Corp")).toBe("acme");
  });

  test("a trailing run of several legal-entity words is dropped as one run", () => {
    // "Group", "Holdings", and "Inc" are all legal-entity words and all sit
    // at the end of the name, so the whole run comes off, not just the last.
    expect(companyMatchKey("Ryan Specialty Group Holdings Inc")).toBe("ryanspecialty");
  });
});

describe("AC 9: legal-entity words are matched whole, never as a substring", () => {
  test("Visa keeps its final letters instead of losing them to the entry for 'sa'", () => {
    expect(companyMatchKey("Visa")).toBe("visa");
  });

  test("Cisco keeps its final letters instead of losing them to the entry for 'co'", () => {
    expect(companyMatchKey("Cisco")).toBe("cisco");
  });
});

describe("AC 10: a bare name and the same name with a legal suffix produce the same key", () => {
  test("Apple and Apple, Inc. match", () => {
    // The value is pinned as well as the equality, because a function
    // returning one constant for everything would satisfy equality alone.
    expect(companyMatchKey("Apple")).toBe("apple");
    expect(companyMatchKey("Apple")).toBe(companyMatchKey("Apple, Inc."));
  });
});

describe("AC 11: a spaced-out name and its closed-up spelling produce the same key", () => {
  test("Git Lab and GitLab match", () => {
    expect(companyMatchKey("Git Lab")).toBe("gitlab");
    expect(companyMatchKey("Git Lab")).toBe(companyMatchKey("GitLab"));
  });
});

describe("AC 12: casing alone does not change the key", () => {
  test("indeed and Indeed match", () => {
    expect(companyMatchKey("indeed")).toBe("indeed");
    expect(companyMatchKey("indeed")).toBe(companyMatchKey("Indeed"));
  });
});

describe("AC 13: letters and digits from a non-Latin script survive into the key", () => {
  test("Яндекс (Yandex, written in Cyrillic) keeps its letters, only lowercased", () => {
    expect(companyMatchKey("Яндекс")).toBe("яндекс");
  });
});

describe("AC 14: a name whose key would come out empty falls back to normalizeCompanyName", () => {
  test("a name made entirely of legal-entity words falls back to the normalized, lowercased name", () => {
    // "LLC" and "Inc" are both legal-entity words, and they are the whole
    // name, so the trailing-run drop removes every word and leaves nothing
    // to join — the fallback has to fire.
    const input = "LLC Inc";
    expect(companyMatchKey(input)).toBe(normalizeCompanyName(input).toLowerCase());
    // Pinned as a literal too, so the test says what the fallback produces
    // rather than only that the two agree. The space survives, because the
    // fallback is the tidied name rather than a rebuilt key.
    expect(companyMatchKey(input)).toBe("llc inc");
  });
});

describe("AC 15: no fixture name produces an empty key", () => {
  test("the fixture used by these tests is not empty", () => {
    // Guards AC 15 and AC 16 below, which both read this same fixture — an
    // emptied fixture would let both pass without checking anything.
    expect(fixture.length).toBeGreaterThan(0);
  });

  test("every name in the fixture produces a non-empty key", () => {
    const offenders = fixture.filter((name) => companyMatchKey(name).length === 0);
    // Collecting the offending names rather than counting them means a
    // failure names what went wrong instead of leaving it to be re-derived.
    expect(offenders).toEqual([]);
  });
});

describe("AC 16: the fixture's shared keys are exactly the recorded merge groups", () => {
  test("names that share a key across the fixture match the recorded groups exactly", () => {
    const byKey = new Map<string, string[]>();
    for (const name of fixture) {
      const key = companyMatchKey(name);
      const names = byKey.get(key) ?? [];
      names.push(name);
      byKey.set(key, names);
    }

    // Only keys shared by more than one name are a "merge" worth recording;
    // a key with a single name isn't a group.
    const actualGroups: [string, string[]][] = Array.from(byKey.entries())
      .filter(([, names]) => names.length > 1)
      .map(([key, names]): [string, string[]] => [key, [...names].sort()])
      .sort(([a], [b]) => a.localeCompare(b));

    const expectedGroups: [string, string[]][] = EXPECTED_MERGE_GROUPS.map(
      ([key, names]): [string, string[]] => [key, [...names].sort()]
    ).sort(([a], [b]) => a.localeCompare(b));

    // One structural comparison rather than a loop of small assertions, so a
    // failure's diff shows exactly which groups are new, missing, or changed.
    expect(actualGroups).toEqual(expectedGroups);
  });
});
