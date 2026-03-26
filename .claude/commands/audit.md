Perform a full audit of the codebase covering security, code quality, and consistency.

## 1. Lint (automated)

Run `npx eslint . --max-warnings 0` and report the results. If ESLint is not configured, note that and skip to the next sections.

## 2. Security

Check for:

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

## 3. Code health (LLM review)

Read through the codebase and flag:

1. **Redundancy** — duplicate logic, copy-pasted code that should be a shared helper
2. **Dead code** — unused functions, exports, imports, unreachable branches
3. **Pattern drift** — violations of CLAUDE.md conventions (e.g. raw hex instead of CSS tokens, `rem`/`px` instead of `em`, Tailwind used for colors, missing eli5 comments)
4. **Inconsistency** — naming, file structure, or architectural patterns that diverge from the rest of the codebase
5. **Simplification opportunities** — overly complex code that could be cleaner
6. **Docker vs. Local** - make sure the app is optimized for an UNRAID Docker installation, but is still set up to work locally.

## Output

Present findings as a summary table (section, category, status, severity) followed by prioritised action items.
