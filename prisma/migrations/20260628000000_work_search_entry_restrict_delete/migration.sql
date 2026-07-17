-- Migration: change WorkSearchEntry onDelete from Cascade to Restrict
-- Prevents accidental deletion of TWC compliance records when Job table is recreated.
-- PRAGMA foreign_keys=OFF is required for safe SQLite table recreation.

PRAGMA foreign_keys=OFF;

-- Step 1: Create the new table with onDelete: Restrict
CREATE TABLE "new_WorkSearchEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "activityType" TEXT NOT NULL,
    "result" TEXT NOT NULL DEFAULT 'Application filed',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkSearchEntry_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Step 2: Copy existing rows
INSERT INTO "new_WorkSearchEntry" ("id", "jobId", "date", "activityType", "result", "createdAt")
SELECT "id", "jobId", "date", "activityType", "result", "createdAt"
FROM "WorkSearchEntry";

-- Step 3: Drop old table and rename
DROP TABLE "WorkSearchEntry";
ALTER TABLE "new_WorkSearchEntry" RENAME TO "WorkSearchEntry";

-- Step 4: Recreate indexes
CREATE INDEX "WorkSearchEntry_jobId_idx" ON "WorkSearchEntry"("jobId");
CREATE INDEX "WorkSearchEntry_date_idx" ON "WorkSearchEntry"("date");

PRAGMA foreign_keys=ON;
