import { PrismaClient } from "../app/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

// TODO: Configure with SQLite adapter when database schema feature lands
export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter: null as never });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
