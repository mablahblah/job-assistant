# Roadmap

Completed initiatives are in [ROADMAP-DONE.md](ROADMAP-DONE.md).

## _CURRENT_ Initiative: Security: Critical Fixes

_Goal: Rotate leaked credentials and lock down external-facing inputs._

- [ |status:not started] - **Rotate API Keys & Scrub Git History** — Real Adzuna + RapidAPI keys in `.env`; rotate credentials, move to `.env.local`, scrub from git history _(audit: critical)_
- [ |status:not started] - **CLI Input Validation** — Add status enum whitelist, score range bounds (1-5), and minutesAgo bounds to `scripts/cli.ts` _(audit: major)_
- [ |status:not started] - **Security Headers on Local Server** — Add CSP, X-Frame-Options, X-Content-Type-Options middleware to `scripts/serve.ts` _(audit: major)_
