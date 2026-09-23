import { adzunaCollector } from "./adzuna";
import { ashbyCollector } from "./ashby";
import { dribbbleCollector } from "./dribbble";
import { greenhouseCollector } from "./greenhouse";
import { jsearchCollector } from "./jsearch";
import { leverCollector } from "./lever";
import { uiuxjobsboardCollector } from "./uiuxjobsboard";
import { ultiproCollector } from "./ultipro";
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
];
