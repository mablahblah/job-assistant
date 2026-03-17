export type Company = {
  id: string
  name: string
  employeeSatisfaction: number // 1–5
  customerSatisfaction: number // 1–5
  workLifeBalance: number // 1–5
  politicalAlignment: number // 1–5
}

export type Job = {
  id: string
  companyId: string
  title: string
  url: string
  location: string
  workMode: string // in-person, hybrid, remote
  postedAt: string // ISO date string
  salaryRange: string // e.g. "$120k–$150k"
  benefits: number // 1–5
  status: string // new, applied, screened, interviewed, tested, offer, rejected
}

export type SearchTerm = {
  id: string
  query: string
}

export type JobWithCompany = Job & {
  company: Company
  score: number // 0–100, computed
}
