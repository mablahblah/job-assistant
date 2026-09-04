import { normalizeCompanyName } from "./company-name";

// Legal-entity words dropped from the end of a company name before it becomes
// a match key. Closed and private: the list does not vary by search, so there
// is nothing here to configure. "group", "holdings" and "holding" are on it
// because "Ryan Specialty" and "Ryan Specialty Group" are one employer.
const LEGAL_ENTITY_WORDS = new Set([
  "inc",
  "incorporated",
  "llc",
  "pllc",
  "ltd",
  "limited",
  "corp",
  "corporation",
  "co",
  "company",
  "plc",
  "llp",
  "lp",
  "pc",
  "gmbh",
  "ag",
  "sa",
  "srl",
  "spa",
  "bv",
  "nv",
  "ab",
  "oy",
  "as",
  "aps",
  "kk",
  "pty",
  "group",
  "holdings",
  "holding",
]);

// Turns a company name into a key that two spellings of one employer both
// produce, so jobs from either spelling reach one company record. The key is
// what company association looks a name up by, and it is a unique column, so
// the database refuses a duplicate employer whatever the matching code does.
export function companyMatchKey(name: string): string {
  // Take the runs of letters and digits and leave everything else behind,
  // testing by Unicode so any script survives. Each word is lowercased on its
  // own rather than the whole string up front, so a letter whose lowercase
  // form carries a separate accent mark does not drag that mark into the key.
  const words = (name.match(/[\p{L}\p{N}]+/gu) ?? []).map((word) => word.toLowerCase());

  // Drop a trailing run of legal-entity words, taking whole words off the end
  // and never stripping substrings. A substring strip of "sa" or "co" would
  // eat the ends of "Visa" and "Cisco", which are not legal suffixes at all.
  let end = words.length;
  while (end > 0 && LEGAL_ENTITY_WORDS.has(words[end - 1])) {
    end -= 1;
  }
  const key = words.slice(0, end).join("");

  // A name made only of legal-entity words, like "LLC Inc", strips to nothing.
  // The tidied name stands in, which keeps two such names apart. A name
  // holding no letter or digit at all still keys to nothing, because the tidy
  // strips it too — company association treats an empty name as no name, so
  // no company is ever created under an empty key.
  if (key === "") {
    return normalizeCompanyName(name).toLowerCase();
  }

  return key;
}
