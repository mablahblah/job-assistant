-- CreateTable
CREATE TABLE "LocationCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "locationString" TEXT NOT NULL,
    "lat" REAL NOT NULL,
    "lon" REAL NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "GeocodingClassRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "className" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "LocationCache_locationString_key" ON "LocationCache"("locationString");

-- CreateIndex
CREATE UNIQUE INDEX "GeocodingClassRule_className_key" ON "GeocodingClassRule"("className");
