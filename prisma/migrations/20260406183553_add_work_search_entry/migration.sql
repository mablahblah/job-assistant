-- AlterTable
ALTER TABLE "Company" ADD COLUMN "address" TEXT;
ALTER TABLE "Company" ADD COLUMN "enrichedAt" DATETIME;
ALTER TABLE "Company" ADD COLUMN "phone" TEXT;
ALTER TABLE "Company" ADD COLUMN "website" TEXT;

-- CreateTable
CREATE TABLE "WorkSearchEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "activityType" TEXT NOT NULL,
    "result" TEXT NOT NULL DEFAULT 'Application filed',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkSearchEntry_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "WorkSearchEntry_jobId_idx" ON "WorkSearchEntry"("jobId");

-- CreateIndex
CREATE INDEX "WorkSearchEntry_date_idx" ON "WorkSearchEntry"("date");
