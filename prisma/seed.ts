import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

const adapter = new PrismaLibSql({ url: "file:./dev.db" });
const prisma = new PrismaClient({ adapter });

const companies = [
  { id: "c1", name: "Atlassian", employeeSatisfaction: 4, customerSatisfaction: 4, workLifeBalance: 5, politicalAlignment: 4 },
  { id: "c2", name: "Canva", employeeSatisfaction: 5, customerSatisfaction: 5, workLifeBalance: 4, politicalAlignment: 3 },
  { id: "c3", name: "Figma", employeeSatisfaction: 5, customerSatisfaction: 5, workLifeBalance: 4, politicalAlignment: 4 },
  { id: "c4", name: "Shopify", employeeSatisfaction: 3, customerSatisfaction: 4, workLifeBalance: 3, politicalAlignment: 3 },
  { id: "c5", name: "Meta", employeeSatisfaction: 3, customerSatisfaction: 2, workLifeBalance: 2, politicalAlignment: 1 },
  { id: "c6", name: "Stripe", employeeSatisfaction: 4, customerSatisfaction: 5, workLifeBalance: 3, politicalAlignment: 4 },
];

const jobs = [
  { id: "j1", companyId: "c1", title: "Senior Product Designer", url: "https://www.atlassian.com/company/careers", location: "Sydney, AU", workMode: "hybrid", postedAt: new Date("2026-03-16T10:00:00Z"), salaryRange: "$140k–$170k", benefits: 4, status: "new" },
  { id: "j2", companyId: "c2", title: "Product Designer, Growth", url: "https://www.canva.com/careers/", location: "Sydney, AU", workMode: "hybrid", postedAt: new Date("2026-03-15T08:00:00Z"), salaryRange: "$130k–$160k", benefits: 5, status: "new" },
  { id: "j3", companyId: "c3", title: "Staff Product Designer", url: "https://www.figma.com/careers/", location: "San Francisco, CA", workMode: "hybrid", postedAt: new Date("2026-03-14T12:00:00Z"), salaryRange: "$160k–$200k", benefits: 5, status: "new" },
  { id: "j4", companyId: "c4", title: "UX Designer, Merchant Experience", url: "https://www.shopify.com/careers", location: "Toronto, CA", workMode: "remote", postedAt: new Date("2026-03-12T09:00:00Z"), salaryRange: "$110k–$140k", benefits: 3, status: "new" },
  { id: "j5", companyId: "c5", title: "Product Designer, Reality Labs", url: "https://www.metacareers.com/", location: "Menlo Park, CA", workMode: "in-person", postedAt: new Date("2026-03-10T14:00:00Z"), salaryRange: "$150k–$190k", benefits: 4, status: "new" },
  { id: "j6", companyId: "c6", title: "Senior Product Designer, Dashboard", url: "https://stripe.com/jobs", location: "San Francisco, CA", workMode: "hybrid", postedAt: new Date("2026-03-17T06:00:00Z"), salaryRange: "$155k–$185k", benefits: 4, status: "new" },
  { id: "j7", companyId: "c1", title: "Design Lead, Jira", url: "https://www.atlassian.com/company/careers", location: "Sydney, AU", workMode: "hybrid", postedAt: new Date("2026-03-08T11:00:00Z"), salaryRange: "$160k–$190k", benefits: 4, status: "applied" },
  { id: "j8", companyId: "c2", title: "Senior UX Designer, Enterprise", url: "https://www.canva.com/careers/", location: "Sydney, AU", workMode: "remote", postedAt: new Date("2026-03-05T07:00:00Z"), salaryRange: "$125k–$155k", benefits: 5, status: "new" },
  { id: "j9", companyId: "c4", title: "Product Designer, Checkout", url: "https://www.shopify.com/careers", location: "Ottawa, CA", workMode: "remote", postedAt: new Date("2026-03-01T10:00:00Z"), salaryRange: "$100k–$130k", benefits: 3, status: "new" },
  { id: "j10", companyId: "c3", title: "Product Designer, FigJam", url: "https://www.figma.com/careers/", location: "New York, NY", workMode: "hybrid", postedAt: new Date("2026-03-13T15:00:00Z"), salaryRange: "$140k–$175k", benefits: 5, status: "new" },
  { id: "j11", companyId: "c6", title: "Product Designer, Connect", url: "https://stripe.com/jobs", location: "Seattle, WA", workMode: "remote", postedAt: new Date("2026-03-11T09:00:00Z"), salaryRange: "$135k–$165k", benefits: 4, status: "new" },
  { id: "j12", companyId: "c5", title: "UX Researcher & Designer, Instagram", url: "https://www.metacareers.com/", location: "New York, NY", workMode: "hybrid", postedAt: new Date("2026-03-02T13:00:00Z"), salaryRange: "$140k–$180k", benefits: 4, status: "new" },
];

async function main() {
  // Clear existing data
  await prisma.job.deleteMany();
  await prisma.company.deleteMany();

  // Seed default search term
  await prisma.searchTerm.upsert({
    where: { query: "Product Designer" },
    update: {},
    create: { query: "Product Designer" },
  });
  console.log("Seeded default search term");

  // Seed companies
  for (const company of companies) {
    await prisma.company.create({ data: company });
  }
  console.log(`Seeded ${companies.length} companies`);

  // Seed jobs
  for (const job of jobs) {
    await prisma.job.create({ data: job });
  }
  console.log(`Seeded ${jobs.length} jobs`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
