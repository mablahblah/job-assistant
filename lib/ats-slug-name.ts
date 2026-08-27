// A stand-in name built from the slug, which a collector replaces with the
// employer's real name. Separators become spaces and each word gets a capital
// first letter, leaving the rest of the word alone.
//
// It lives here because the seed script and the ATS collectors both build this
// same name, and two copies would be two rules.
export function nameFromSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
