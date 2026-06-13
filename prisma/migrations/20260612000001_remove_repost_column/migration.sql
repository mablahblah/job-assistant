-- Migration: remove the write-only repost boolean column
-- repostedAt (added in 20260612000000) replaces it entirely.

-- Step 1: Create the new table without the repost column
CREATE TABLE "new_Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "location" TEXT NOT NULL DEFAULT '',
    "workMode" TEXT NOT NULL DEFAULT 'remote',
    "firstPublished" DATETIME NOT NULL,
    "repostedAt" DATETIME,
    "salaryRange" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'backlog',
    "locationFlagged" BOOLEAN NOT NULL DEFAULT false,
    "jobAlignment" INTEGER,
    "titleMismatch" BOOLEAN NOT NULL DEFAULT false,
    "titleMismatchReason" TEXT,
    "source" TEXT,
    "parser" TEXT,
    "originalUrl" TEXT,
    "modifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Job_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Step 2: Copy all rows (repost column excluded)
INSERT INTO "new_Job" (
    "id", "companyId", "title", "url", "location", "workMode",
    "firstPublished", "repostedAt",
    "salaryRange", "status", "locationFlagged", "jobAlignment",
    "titleMismatch", "titleMismatchReason", "source", "parser",
    "originalUrl", "modifiedAt", "createdAt", "updatedAt"
)
SELECT
    "id", "companyId", "title", "url", "location", "workMode",
    "firstPublished", "repostedAt",
    "salaryRange", "status", "locationFlagged", "jobAlignment",
    "titleMismatch", "titleMismatchReason", "source", "parser",
    "originalUrl", "modifiedAt", "createdAt", "updatedAt"
FROM "Job";

-- Step 3: Drop the old table
DROP TABLE "Job";

-- Step 4: Rename the new table
ALTER TABLE "new_Job" RENAME TO "Job";

-- Step 5: Recreate indexes
CREATE UNIQUE INDEX "Job_url_key" ON "Job"("url");
CREATE INDEX "Job_companyId_idx" ON "Job"("companyId");
CREATE INDEX "Job_status_idx" ON "Job"("status");
