Perform a security audit of the codebase. Check for:

1. **Environment/secrets** — hardcoded secrets, API keys, or credentials in source code; .env in .gitignore
2. **SQL injection / Prisma safety** — raw SQL queries or unsafe Prisma usage
3. **Input validation** — server actions and API routes properly validating input
4. **XSS** — dangerouslySetInnerHTML, unescaped user input in JSX
5. **CSRF** — server action protection
6. **Dependencies** — run `npm audit` and flag vulnerabilities
7. **Docker** — non-root user, minimal image, no secrets in layers
8. **Database** — SQLite file not publicly accessible
9. **Headers/CORS** — custom headers, security headers middleware
10. **Auth** — authentication/authorization mechanisms or lack thereof

Present findings as a summary table (category, status, risk level) followed by prioritised action items.
