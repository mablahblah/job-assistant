import { prisma } from "@/lib/prisma";
import { calculateScore } from "@/lib/scoring";
import { JobWithCompany } from "@/lib/types";
import JobsTable from "@/components/JobsTable";

export default async function Home() {
  const dbJobs = await prisma.job.findMany({
    include: { company: true },
  });

  const jobs: JobWithCompany[] = dbJobs
    .map((job) => ({
      id: job.id,
      companyId: job.companyId,
      title: job.title,
      url: job.url,
      location: job.location,
      workMode: job.workMode,
      postedAt: job.postedAt.toISOString(),
      salaryRange: job.salaryRange,
      benefits: job.benefits,
      status: job.status,
      company: {
        id: job.company.id,
        name: job.company.name,
        employeeSatisfaction: job.company.employeeSatisfaction,
        customerSatisfaction: job.company.customerSatisfaction,
        workLifeBalance: job.company.workLifeBalance,
        politicalAlignment: job.company.politicalAlignment,
      },
      score: calculateScore(
        { ...job, postedAt: job.postedAt.toISOString() },
        job.company
      ),
    }))
    .sort((a, b) => b.score - a.score);

  return <JobsTable jobs={jobs} />;
}
