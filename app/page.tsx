// Never prerender — this page queries the live DB on every request
export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { calculateScore } from "@/lib/scoring";
import { JobWithCompany, SearchTerm } from "@/lib/types";
import { expireOldBacklogJobs } from "@/app/actions";
import JobsTable from "@/components/JobsTable";

export default async function Home() {
  // Auto-expire stale backlog jobs before fetching the list
  await expireOldBacklogJobs();

  const [dbJobs, dbSearchTerms] = await Promise.all([
    prisma.job.findMany({ include: { company: true } }),
    prisma.searchTerm.findMany({ orderBy: { createdAt: "asc" } }),
  ]);

  const searchTerms: SearchTerm[] = dbSearchTerms
    .filter((t) => !t.query.startsWith("__"))
    .map((t) => ({ id: t.id, query: t.query }));

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
        note: job.company.note,
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
        modifiedAt: job.modifiedAt?.toISOString() ?? null,
        locationFlagged: job.locationFlagged,
        company,
        score: calculateScore(
          { ...job, postedAt: job.postedAt.toISOString(), modifiedAt: job.modifiedAt?.toISOString() ?? null },
          company
        ),
      };
    })
    .sort((a, b) => b.score - a.score);

  return (
    <Suspense>
      <JobsTable jobs={jobs} searchTerms={searchTerms} />
    </Suspense>
  );
}
