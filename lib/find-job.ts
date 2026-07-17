import { prisma } from "@/lib/prisma";

// Looks up jobs by fuzzy company name and optional role.
// Both use case-insensitive substring matching (SQLite LIKE is case-insensitive for ASCII).
export async function findJobs(company: string, role?: string) {
  const where = {
    company: { name: { contains: company } },
    ...(role ? { title: { contains: role } } : {}),
  };

  const jobs = await prisma.job.findMany({
    where,
    include: { company: true },
    orderBy: { firstPublished: "desc" },
  });

  return jobs.map((j) => ({
    id: j.id,
    title: j.title,
    company: j.company.name,
    status: j.status,
    location: j.location,
    workMode: j.workMode,
    salary: j.salaryRange,
    url: j.url,
    posted: j.firstPublished.toISOString().slice(0, 10),
  }));
}
