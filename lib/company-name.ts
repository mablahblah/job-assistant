// Tidies a source's raw_company_name into a single consistent spelling: no
// leading or trailing whitespace, no doubled internal spaces, no trailing
// punctuation. Case and internal spacing are left exactly as the source
// wrote them — deciding that two spellings name the same employer is a
// matching judgement, and belongs to company association's name lookup
// rather than this cosmetic tidy.
//
// The cleaned name overwrites raw_company_name with no copy of the source
// spelling kept, so this has to reach a fixed point in one pass: running it
// on its own output must return the same string, or the value would drift a
// little further on every run with nothing able to detect it.

export function normalizeCompanyName(raw: string): string {
  return raw
    .trim() // drop leading and trailing whitespace
    .replace(/\s+/g, " ") // collapse internal runs of whitespace to one space
    // Drop a trailing run of characters that are not a Unicode letter or
    // digit — the period on "Inc.", a trademark mark, or anything else.
    // Anchored to the end, so it never touches punctuation inside the name.
    // The run is taken whole, so a name carrying both a mark and a space at
    // the end settles whichever order the source wrote them in.
    .replace(/[^\p{L}\p{N}]+$/u, "");
}
