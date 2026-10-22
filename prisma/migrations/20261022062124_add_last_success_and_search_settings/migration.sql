-- AlterTable
ALTER TABLE "Setting" ADD COLUMN "excluded_titles" JSONB;
ALTER TABLE "Setting" ADD COLUMN "remote_labels" JSONB;
ALTER TABLE "Setting" ADD COLUMN "search_towns" JSONB;
ALTER TABLE "Setting" ADD COLUMN "search_window_days" INTEGER;

-- CreateTable
CREATE TABLE "LastSuccess" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collector" TEXT NOT NULL,
    "search" TEXT NOT NULL,
    "succeeded_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "LastSuccess_collector_search_key" ON "LastSuccess"("collector", "search");


-- The seed only fills settings that are empty and never reorders the
-- ranking, so the stored values are changed here once. An empty table, as in
-- Prisma's shadow database, has no row to update, so nothing happens there.

-- The new collector ranks directly after Workable's collector. The ranking is
-- edited as text, so every other entry keeps its exact place.
UPDATE "Setting"
SET "source_priority_list" = replace(
  "source_priority_list",
  '"collector:workable"',
  '"collector:workable", "collector:fantastic-jobs"'
)
WHERE "id" = 1;

-- The new collector's job links carry their identity in these two query
-- values, so they are added after the one already held.
UPDATE "Setting"
SET "identifying_query_values" = json_insert(
  "identifying_query_values",
  '$[#]', 'reqId',
  '$[#]', 'gh_jid'
)
WHERE "id" = 1;
