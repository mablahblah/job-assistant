// The single registration list for every ATS parser. Both the production
// pipeline and the dry-run script call this, so the two cannot drift apart.

import { registerParser } from "./registry";
import { parseAshbyJob } from "./ashby";
import { parseGreenhouseJob } from "./greenhouse";
import { parseLeverJob } from "./lever";
import { parseAdzunaJob } from "./adzuna";
import { parseDribbbleJob } from "./dribbble";

// Registers every parser against the domain it handles.
export function registerAllParsers(): void {
  registerParser("jobs.ashbyhq.com", parseAshbyJob);
  registerParser("boards.greenhouse.io", parseGreenhouseJob);
  registerParser("jobs.lever.co", parseLeverJob);
  registerParser("adzuna.com", parseAdzunaJob);
  registerParser("dribbble.com", parseDribbbleJob);
}
