/*
  Warnings:

  - You are about to drop the `JobSource` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SearchTerm` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "JobSource";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "SearchTerm";
PRAGMA foreign_keys=on;
