/*
  Warnings:

  - You are about to drop the column `benefits` on the `Job` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Company" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "employeeSatisfaction" INTEGER,
    "customerSatisfaction" INTEGER,
    "workLifeBalance" INTEGER,
    "politicalAlignment" INTEGER,
    "benefits" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Company" ("createdAt", "customerSatisfaction", "employeeSatisfaction", "id", "name", "politicalAlignment", "updatedAt", "workLifeBalance") SELECT "createdAt", "customerSatisfaction", "employeeSatisfaction", "id", "name", "politicalAlignment", "updatedAt", "workLifeBalance" FROM "Company";
DROP TABLE "Company";
ALTER TABLE "new_Company" RENAME TO "Company";
CREATE UNIQUE INDEX "Company_name_key" ON "Company"("name");
CREATE TABLE "new_Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "location" TEXT NOT NULL DEFAULT '',
    "workMode" TEXT NOT NULL DEFAULT 'remote',
    "postedAt" DATETIME NOT NULL,
    "salaryRange" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Job_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Job" ("companyId", "createdAt", "id", "location", "postedAt", "salaryRange", "status", "title", "updatedAt", "url", "workMode") SELECT "companyId", "createdAt", "id", "location", "postedAt", "salaryRange", "status", "title", "updatedAt", "url", "workMode" FROM "Job";
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";
CREATE INDEX "Job_companyId_idx" ON "Job"("companyId");
CREATE INDEX "Job_status_idx" ON "Job"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
