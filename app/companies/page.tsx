import { prisma } from "@/lib/prisma";
import CompaniesTable from "@/components/CompaniesTable";

export default async function CompaniesPage() {
  const dbCompanies = await prisma.company.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { jobs: true } } },
  });

  const companies = dbCompanies.map((c) => ({
    id: c.id,
    name: c.name,
    jobCount: c._count.jobs,
    employeeSatisfaction: c.employeeSatisfaction,
    customerSatisfaction: c.customerSatisfaction,
    workLifeBalance: c.workLifeBalance,
    politicalAlignment: c.politicalAlignment,
    benefits: c.benefits,
  }));

  return <CompaniesTable companies={companies} />;
}
