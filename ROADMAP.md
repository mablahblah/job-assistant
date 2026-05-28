# Roadmap

Completed initiatives are in [ROADMAP-DONE.md](ROADMAP-DONE.md).

## Initiative: Security: Critical Fixes — [plan](docs/initiatives/security-critical-fixes/initiative.md)

_Goal: Rotate leaked credentials and lock down external-facing inputs._

- [x|status:done] - **Scrub Credentials from Git History** — Scrub leaked Adzuna keys from `.env.local.example` history, rename to `.env.example` with all services _(audit: critical)_
  - [Discovery Summary](docs/initiatives/security-critical-fixes/scrub-credentials/discovery-summary.md)
  - [Feature Spec](docs/initiatives/security-critical-fixes/scrub-credentials/feature-spec.md)
  - [Implementation Plan](docs/initiatives/security-critical-fixes/scrub-credentials/implementation-plan.md)
- [x|status:done] - **CLI Input Validation** — Add status enum whitelist and score range bounds (1-5) to CLI boundary _(audit: major)_
  - [Discovery Summary](docs/initiatives/security-critical-fixes/cli-input-validation/discovery-summary.md)
  - [Feature Spec](docs/initiatives/security-critical-fixes/cli-input-validation/feature-spec.md)
  - [Implementation Plan](docs/initiatives/security-critical-fixes/cli-input-validation/implementation-plan.md)
