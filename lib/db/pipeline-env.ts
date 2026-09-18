// Looks up the new pipeline's database connection string.
//
// The lookup runs inside the function, at call time. That is what makes the
// missing-variable case testable: a test deletes PIPELINE_DATABASE_URL and
// calls this directly, so dotenv — which only runs when prisma.config.ts is
// imported — never gets a chance to put the variable back first.
export function getPipelineDatabaseUrl(): string {
  const url = process.env["PIPELINE_DATABASE_URL"];
  if (!url) {
    throw new Error(
      "PIPELINE_DATABASE_URL is not set. Add it to .env — the pipeline " +
        "database is separate from the legacy DATABASE_URL and does not " +
        "fall back to it."
    );
  }
  return url;
}
