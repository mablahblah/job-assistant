// Loads .env, which is where the database url normally lives. It sits here
// rather than in each caller because this is the one door to the database, so
// a collector or service reaching for it never has to remember. A caller that
// sets PIPELINE_DATABASE_URL itself still wins, because dotenv never
// overwrites a variable that is already set.
import "dotenv/config";
import { PrismaClient } from "../../generated/pipeline/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { getPipelineDatabaseUrl } from "./pipeline-env";

// Builds a Prisma client for the pipeline database. A factory rather than a
// cached singleton, because the url is read at call time, so a caller that
// points PIPELINE_DATABASE_URL somewhere else gets a client that follows it.
export function createPipelineDb(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaLibSql({ url: getPipelineDatabaseUrl() }),
  });
}
