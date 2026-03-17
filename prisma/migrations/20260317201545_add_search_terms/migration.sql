-- CreateTable
CREATE TABLE "SearchTerm" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "query" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "SearchTerm_query_key" ON "SearchTerm"("query");
