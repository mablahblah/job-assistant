import { adzunaCollector } from "./adzuna";
import { greenhouseCollector } from "./greenhouse";
import { jsearchCollector } from "./jsearch";
import { leverCollector } from "./lever";
import type { Collector } from "./types";

// Every collector a search runs, in the order it runs them. A collector joins
// the search by being listed here and nowhere else.
export const COLLECTORS: Collector[] = [
  adzunaCollector,
  jsearchCollector,
  greenhouseCollector,
  leverCollector,
];
