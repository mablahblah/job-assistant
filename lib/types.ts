export type Company = {
  id: string
  name: string
  employeeSatisfaction: number | null // 1–5
  customerSatisfaction: number | null // 1–5
  workLifeBalance: number | null // 1–5
  politicalAlignment: number | null // 1–5
  note: string | null // brief scoring rationale from Claude
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
  status: string // backlog, too far, won't apply, app. sent, rejected, screening, interview, test, offer, repost, expired
  modifiedAt: string | null // ISO date when status was last changed
  locationFlagged: boolean // true when remote location couldn't be classified
  jobAlignment: number | null // 1–5, job alignment score from Claude
  titleMismatch: boolean // true when title doesn't match search intent
  titleMismatchReason: string | null // Claude's reason for flagging
  isUnresolvedAggregator: boolean // true when company is a known aggregator not yet resolved
}

export type SearchTerm = {
  id: string
  query: string
}

export type JobWithCompany = Job & {
  company: Company
  score: number // 0–100, computed
}
