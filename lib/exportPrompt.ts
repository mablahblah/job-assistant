// Generates a prompt with pre-filled JSON so Claude only fills in null scores
// and adds a note — company names are seeded exactly from the DB to prevent mismatches.

type ExportCompany = {
  name: string
  jobUrl: string | null
  employeeSatisfaction: number | null
  customerSatisfaction: number | null
  workLifeBalance: number | null
  politicalAlignment: number | null
  benefits: number | null
}

const SCORE_FIELDS = [
  "employeeSatisfaction",
  "customerSatisfaction",
  "workLifeBalance",
  "politicalAlignment",
  "benefits",
] as const

export function generateCompanyPrompt(companies: ExportCompany[]): string | null {
  // Only include companies missing at least one score
  const needsScoring = companies.filter((c) =>
    SCORE_FIELDS.some((f) => c[f] === null)
  )

  if (needsScoring.length === 0) return null

  // Pre-fill the JSON with exact DB names so Claude returns them unchanged
  const prefilledJson = JSON.stringify(
    needsScoring.map((c) => ({
      company: c.name,
      jobUrl: c.jobUrl,
      employeeSatisfaction: c.employeeSatisfaction,
      customerSatisfaction: c.customerSatisfaction,
      workLifeBalance: c.workLifeBalance,
      politicalAlignment: c.politicalAlignment,
      benefits: c.benefits,
      note: null,
    })),
    null,
    2
  )

  return `Research and score the following companies for a Product Designer job search. Fill in any null score fields using a 1–5 scale, and write a brief "note" for each company explaining your assessment.

**Do not change the "company" or "jobUrl" values — return them exactly as provided.**

\`\`\`json
${prefilledJson}
\`\`\`
`
}
