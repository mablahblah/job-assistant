import { PrismaClient } from "../generated/pipeline/client";
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
