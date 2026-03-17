-- CreateTable
CREATE TABLE "JobSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "searchTermId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobSource_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JobSource_searchTermId_fkey" FOREIGN KEY ("searchTermId") REFERENCES "SearchTerm" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "JobSource_jobId_idx" ON "JobSource"("jobId");

-- CreateIndex
CREATE INDEX "JobSource_searchTermId_idx" ON "JobSource"("searchTermId");

-- CreateIndex
CREATE UNIQUE INDEX "JobSource_jobId_searchTermId_key" ON "JobSource"("jobId", "searchTermId");
