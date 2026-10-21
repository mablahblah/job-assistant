# Job Search Assistant

A personal job search tool, run from the command line through Claude Code skills. It finds job postings, ranks them, tracks applications, and keeps the Texas Workforce Commission unemployment work log.

One person built it for their own job search. It runs on one machine, against one local database file.

## What it does

| Job | How |
| --- | --- |
| Find jobs | Pulls postings from 14 sources: job search services, company hiring sites, and design job boards. Follows each link to the employer's own posting and reads it. Removes duplicates. |
| Rank jobs | Drops jobs that are too old or too far away. A Claude agent then scores how well each job fits, and researches each employer. |
| Track jobs | Records each job's status, from backlog through applied, interview and offer. A read-only dashboard shows every list. |
| File the work log | Moving a job to applied, screening or interview writes a work log entry for the Texas Workforce Commission. It also looks up the employer's address and phone number. |
| Tailor a resume | Builds a resume PDF for one job from existing resume items. This needs a separate portfolio project. |

## How you use it

Most work runs through Claude Code skills. Each skill calls the commands below in the right order.

| Skill | What it does |
| --- | --- |
| `/job-search` | Runs a full job search, then scores the backlog. |
| `/score-backlog` | Scores every unscored job and researches every unscored employer. |
| `/change-status` | Finds a job by its link or employer, sets its new status, and files a work log entry where one is needed. |
| `/add-external-jobs` | Adds jobs you found yourself, from their links. |
| `/generate-resume` | Builds a tailored resume PDF for one job. |

## Setup

You need Node.js 20 or newer and Claude Code.

1. Install the packages. This also builds the database code.

   ```bash
   npm install
   npx playwright install chromium
   ```

2. Create the database, before you create `.env`. Only do this on a fresh copy of the project, with no `pipeline.db` yet. This command deletes whatever file it is given.

   ```bash
   npm run db:create ./pipeline.db
   ```

3. Copy `.env.example` to `.env`, and fill in the keys you have.

   | Key | Used for |
   | --- | --- |
   | `PIPELINE_DATABASE_URL` | Where the database file is. Leave it as `file:./pipeline.db`. |
   | `ADZUNA_APP_ID`, `ADZUNA_API_KEY` | The Adzuna job search source |
   | `RAPIDAPI_KEY` | The JSearch job search source |
   | `GEOCODE_MAPS_API_KEY` | Turning a job's location into a point on a map, to measure distance |
   | `APIFY_API_TOKEN` | Looking up an employer's address and phone for the work log |

4. Fill in the default settings.

   ```bash
   npm run db:seed
   ```

5. Check that everything works.

   ```bash
   npm run test
   npm run lint
   ```

Once `.env` names the database, `db:create` refuses to touch it. From then on, change the database's structure only with `npm run db:migrate`, which makes a dated backup first.

## Commands

| Command | What it does |
| --- | --- |
| `npm run job-search` | Runs the whole search, and prints its run identifier first |
| `npm run score:gather -- --out FILE` | Writes out every job and employer still needing a score |
| `npm run score:save -- --in FILE` | Saves the scores an agent worked out |
| `npm run find-jobs -- --url U --company X` | Finds a job by its link, or by part of its employer's name |
| `npm run change-status -- --in FILE` | Sets job statuses by hand, and files work log entries |
| `npm run add-external-jobs -- --in FILE` | Adds jobs from links you found yourself |
| `npm run recover-unparseable-jobs` | Run once after adding a new parser. Gives jobs that could not be read another try. |
| `npm run fetch-rendered-page -- --url URL` | Prints a page's HTML after its scripts have run |
| `npm run serve` | Starts the read-only dashboard |
| `npm run db:create FILE` | Rebuilds a named database from scratch. Refuses the real one. |
| `npm run db:migrate` | Changes the database structure, keeping every row. Backs up first. |
| `npm run db:seed` | Fills in absent settings. Overwrites nothing. |
| `npm run test` | Runs the tests |
| `npm run lint` | Checks code style, then checks types |

## Documentation

| Where | What it holds |
| --- | --- |
| [`wiki/`](wiki/index.md) | The full wiki: onboarding guides, setup, and how each part works. |
| [`docs/architecture.md`](docs/architecture.md) | The system as built, and why each part works the way it does. |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Decisions that shape the whole project. |
| [`docs/CHANGELOG.md`](docs/CHANGELOG.md) | What changed in each version. |
| [`CLAUDE.md`](CLAUDE.md) and [`.claude/rules/`](.claude/rules/) | The rules for working on the code. |

To read the wiki as a website:

```bash
cd wiki
npm install
npm run docs:dev
```

## Tech stack

| Part | Tool |
| --- | --- |
| Language | TypeScript, run directly with `tsx`, no build step |
| Database | SQLite, through Prisma |
| Browser | Playwright, for following job links |
| Reading HTML | linkedom |
| Dashboard | HTML built on the server, plain CSS and JavaScript |
| Tests | Vitest |

## Privacy

Your real data never goes to GitHub. Git ignores these files and folders:

- The database files
- `.env`
- `resumes/` and `data/`
- Your private job profile, `.claude/skills/score-backlog/.alignment-info.md`
- Personal planning docs under `docs/`

The public example profile, `.alignment-info.example.md`, is made up.
