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
    "note" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "enrichedAt" DATETIME,
    "enrichmentUncertain" BOOLEAN NOT NULL DEFAULT false,
    "enrichmentFlags" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Company" ("address", "benefits", "createdAt", "customerSatisfaction", "employeeSatisfaction", "enrichedAt", "id", "name", "note", "phone", "politicalAlignment", "updatedAt", "website", "workLifeBalance") SELECT "address", "benefits", "createdAt", "customerSatisfaction", "employeeSatisfaction", "enrichedAt", "id", "name", "note", "phone", "politicalAlignment", "updatedAt", "website", "workLifeBalance" FROM "Company";
DROP TABLE "Company";
ALTER TABLE "new_Company" RENAME TO "Company";
CREATE UNIQUE INDEX "Company_name_key" ON "Company"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
