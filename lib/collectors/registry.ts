import { adzunaCollector } from "./adzuna";
import { ashbyCollector } from "./ashby";
import { bamboohrCollector } from "./bamboohr";
import { dribbbleCollector } from "./dribbble";
import { fantasticJobsCollector } from "./fantastic-jobs";
import { gemCollector } from "./gem";
import { greenhouseCollector } from "./greenhouse";
import { jsearchCollector } from "./jsearch";
import { leverCollector } from "./lever";
import { ripplingCollector } from "./rippling";
import { smartrecruitersCollector } from "./smartrecruiters";
import { uiuxjobsboardCollector } from "./uiuxjobsboard";
import { ultiproCollector } from "./ultipro";
import { workableCollector } from "./workable";
import { workdayCollector } from "./workday";
import type { Collector } from "./collector";

// Every collector a search runs, in the order it runs them. A collector joins
// the search by being listed here and nowhere else.
export const COLLECTORS: Collector[] = [
  adzunaCollector,
  jsearchCollector,
  greenhouseCollector,
  leverCollector,
  ashbyCollector,
  dribbbleCollector,
  uiuxjobsboardCollector,
  workdayCollector,
  ultiproCollector,
  gemCollector,
  smartrecruitersCollector,
  bamboohrCollector,
  ripplingCollector,
  workableCollector,
  fantasticJobsCollector,
];
