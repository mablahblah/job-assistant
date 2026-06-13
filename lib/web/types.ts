// Data shapes for web view rendering — mirrors Prisma return types with includes

export type WebJob = {
  id: string;
  score: number; // computed at request time via calculateScore, not persisted
  status: string;
  title: string;
  url: string;
  workMode: string; // "remote", "hybrid", "in-person"
  location: string;
  firstPublished: Date;
  repostedAt: Date | null;
  salaryRange: string;
  jobAlignment: number | null; // 1–5
  modifiedAt: Date | null;
  company: {
    name: string;
    note: string | null;
    employeeSatisfaction: number | null; // 1–5
    customerSatisfaction: number | null; // 1–5
    workLifeBalance: number | null; // 1–5
    politicalAlignment: number | null; // 1–5
  };
};

export type WebWorkLogEntry = {
  id: string;
  date: string; // ISO date string — matches groupEntriesByWeek input
  activityType: string;
  result: string;
  job: {
    title: string;
    company: {
      name: string;
      address: string | null;
      phone: string | null;
      website: string | null;
      enrichmentStatus: string | null; // null, "pending", "complete", "failed"
    };
  };
};

export type TableVariant = "backlog" | "active" | "disqualified";

export type PageData = {
  backlog: WebJob[];
  active: WebJob[];
  disqualified: WebJob[];
  workLogEntries: WebWorkLogEntry[];
  weekSlots: Date[];
};
