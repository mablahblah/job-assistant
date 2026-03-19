import { prisma } from "@/lib/prisma";
import CompaniesTable from "@/components/CompaniesTable";

// Parse the upper bound from a salary string like "$120k–$150k" → 150000
function parseSalaryMax(salary: string): number {
  const matches = salary.match(/\d+/g)
  if (!matches) return 0
  const last = parseInt(matches[matches.length - 1], 10)
  // If the string contains "k" after the number, multiply
  return salary.toLowerCase().includes("k") ? last * 1000 : last
}

export default async function CompaniesPage() {
  const dbCompanies = await prisma.company.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { jobs: true } },
      jobs: { select: { url: true, salaryRange: true }, orderBy: { postedAt: "desc" } },
    },
  });

  const companies = dbCompanies.map((c) => {
    // Pick the job with the highest salary, or fall back to most recent
    const topJob = c.jobs.length > 0
      ? c.jobs.reduce((best, job) =>
          parseSalaryMax(job.salaryRange) > parseSalaryMax(best.salaryRange) ? job : best
        )
      : null

    return {
      id: c.id,
      name: c.name,
      jobCount: c._count.jobs,
      jobUrl: topJob?.url ?? null,
      employeeSatisfaction: c.employeeSatisfaction,
      customerSatisfaction: c.customerSatisfaction,
      workLifeBalance: c.workLifeBalance,
      politicalAlignment: c.politicalAlignment,
      benefits: c.benefits,
    }
  });

  return <CompaniesTable companies={companies} />;
}
