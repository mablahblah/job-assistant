-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "location" TEXT NOT NULL DEFAULT '',
    "workMode" TEXT NOT NULL DEFAULT 'remote',
    "postedAt" DATETIME NOT NULL,
    "salaryRange" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'backlog',
    "locationFlagged" BOOLEAN NOT NULL DEFAULT false,
    "jobAlignment" INTEGER,
    "titleMismatch" BOOLEAN NOT NULL DEFAULT false,
    "titleMismatchReason" TEXT,
    "isUnresolvedAggregator" BOOLEAN NOT NULL DEFAULT false,
    "repost" BOOLEAN NOT NULL DEFAULT false,
    "modifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Job_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Job" ("companyId", "createdAt", "id", "isUnresolvedAggregator", "jobAlignment", "location", "locationFlagged", "modifiedAt", "postedAt", "salaryRange", "status", "title", "titleMismatch", "titleMismatchReason", "updatedAt", "url", "workMode") SELECT "companyId", "createdAt", "id", "isUnresolvedAggregator", "jobAlignment", "location", "locationFlagged", "modifiedAt", "postedAt", "salaryRange", "status", "title", "titleMismatch", "titleMismatchReason", "updatedAt", "url", "workMode" FROM "Job";
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";
CREATE INDEX "Job_companyId_idx" ON "Job"("companyId");
CREATE INDEX "Job_status_idx" ON "Job"("status");
CREATE UNIQUE INDEX "Job_url_key" ON "Job"("url");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Data migration: convert "repost" status to backlog + repost flag
UPDATE "Job" SET "status" = 'backlog', "repost" = true WHERE "status" = 'repost';
