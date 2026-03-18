import { prisma } from "@/lib/prisma";
import { calculateScore } from "@/lib/scoring";
import { JobWithCompany, SearchTerm } from "@/lib/types";
import JobsTable from "@/components/JobsTable";

export default async function Home() {
  const [dbJobs, dbSearchTerms] = await Promise.all([
    prisma.job.findMany({ include: { company: true } }),
    prisma.searchTerm.findMany({ orderBy: { createdAt: "asc" } }),
  ]);

  const searchTerms: SearchTerm[] = dbSearchTerms.map((t) => ({ id: t.id, query: t.query }));

  const jobs: JobWithCompany[] = dbJobs
    .map((job) => {
      const company: JobWithCompany["company"] = {
        id: job.company.id,
        name: job.company.name,
        employeeSatisfaction: job.company.employeeSatisfaction,
        customerSatisfaction: job.company.customerSatisfaction,
        workLifeBalance: job.company.workLifeBalance,
        politicalAlignment: job.company.politicalAlignment,
        benefits: job.company.benefits,
      };
      return {
        id: job.id,
        companyId: job.companyId,
        title: job.title,
        url: job.url,
        location: job.location,
        workMode: job.workMode,
        postedAt: job.postedAt.toISOString(),
        salaryRange: job.salaryRange,
        status: job.status,
        company,
        score: calculateScore(
          { ...job, postedAt: job.postedAt.toISOString() },
          company
        ),
      };
    })
    .sort((a, b) => b.score - a.score);

  return <JobsTable jobs={jobs} searchTerms={searchTerms} />;
}
