// Generates a markdown prompt listing companies that need scoring,
// with a job posting link for each, and the expected JSON response format.

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

  const companyList = needsScoring
    .map((c) => {
      const link = c.jobUrl ? `: ${c.jobUrl}` : ""
      return `- ${c.name}${link}`
    })
    .join("\n")

  const jsonExample = JSON.stringify(
    [
      {
        company: "Company Name",
        employeeSatisfaction: 4,
        customerSatisfaction: 3,
        workLifeBalance: 5,
        politicalAlignment: 2,
        benefits: 4,
      },
    ],
    null,
    2
  )

  return `I need to gather scores for the following companies / roles:

${companyList}

Return the results in the following JSON format:

\`\`\`json
${jsonExample}
\`\`\`
`
}
