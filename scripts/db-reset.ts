// Empties the pipeline database of everything a job-search run produced,
// while keeping configuration. Jobs are deleted before companies so no job is
// ever left pointing at a company that is gone. The Setting row is never
// touched, because any write to it — even writing back the same values —
// would move modified_at.
import { createPipelineDb } from "../lib/pipeline-db";

type PipelineDb = ReturnType<typeof createPipelineDb>;

async function resetJobs(prisma: PipelineDb): Promise<void> {
  const { count } = await prisma.job.deleteMany();
  console.log(`Jobs: deleted ${count}`);
}

async function resetTraces(prisma: PipelineDb): Promise<void> {
  const { count } = await prisma.trace.deleteMany();
  console.log(`Traces: deleted ${count}`);
}

async function resetCompanies(prisma: PipelineDb): Promise<void> {
  // A company carrying an ats_slug is a board the pipeline polls, so it is
  // configuration rather than run output and survives.
  const { count } = await prisma.company.deleteMany({ where: { ats_slug: null } });
  console.log(`Companies: deleted ${count} without an ATS slug`);
}

async function main(): Promise<void> {
  const prisma = createPipelineDb();
  try {
    await resetJobs(prisma);
    await resetTraces(prisma);
    await resetCompanies(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
