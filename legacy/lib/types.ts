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
  firstPublished: string // ISO date string
  repostedAt: string | null // ISO date string, null if never reposted
  salaryRange: string // e.g. "$120k–$150k"
  status: string // backlog, too far, won't apply, app. sent, rejected, screening, interview, test, offer, expired
  modifiedAt: string | null // ISO date when status was last changed
  locationFlagged: boolean // true when remote location couldn't be classified
  jobAlignment: number | null // 1–5, job alignment score from Claude
  titleMismatch: boolean // true when title doesn't match search intent
  titleMismatchReason: string | null // Claude's reason for flagging
  source: string | null // which collector found this job (e.g. "adzuna", "dribbble", "external")
  parser: string | null // which parser processed it (e.g. "ashby", "collector-only"), null if unparsed
  originalUrl: string | null // original collector URL (provenance — where the collector found this job)
}

export type JobWithCompany = Job & {
  company: Company
  score: number // 0–100, computed
}
