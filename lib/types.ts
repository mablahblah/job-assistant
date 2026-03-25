export type Company = {
  id: string
  name: string
  employeeSatisfaction: number | null // 1–5
  customerSatisfaction: number | null // 1–5
  workLifeBalance: number | null // 1–5
  politicalAlignment: number | null // 1–5
  benefits: number | null // 1–5
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
  status: string // backlog, too far, won't apply, app. sent, rejected, screening, interview, test, offer
  modifiedAt: string | null // ISO date when status was last changed
  locationFlagged: boolean // true when remote location couldn't be classified
}

export type SearchTerm = {
  id: string
  query: string
}

export type JobWithCompany = Job & {
  company: Company
  score: number // 0–100, computed
}
