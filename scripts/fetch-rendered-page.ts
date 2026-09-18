// Fetches one job posting through a browser-rendering fetcher and prints the
// finished HTML to stdout. Exists because the resume skill needs the DOM
// after page scripts have run: many postings build their text client-side,
// so a plain HTTP fetch would hand back an empty shell.

import { pathToFileURL } from "node:url";
import {
  createRenderedPageFetcher,
  type RenderedPageFetcher,
} from "../lib/tools/rendered-page-fetcher";

// Reads a `--name value` pair off the command line. Undefined when the flag
// is absent, so the caller decides what that means.
function flagValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return argv[index + 1];
}

export async function runFetchRenderedPage(
  argv: string[],
  fetcher: RenderedPageFetcher,
  out: (line: string) => void,
  err: (line: string) => void
): Promise<number> {
  const url = flagValue(argv, "url");
  if (url === undefined) {
    err("Missing required flag: --url <the page's web address>");
    return 1;
  }

  try {
    const html = await fetcher.fetch(url);
    out(html);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    err(`Failed to fetch rendered page at ${url}: ${message}`);
    return 1;
  }
}

async function main(): Promise<void> {
  const exitCode = await runFetchRenderedPage(
    process.argv.slice(2),
    createRenderedPageFetcher(),
    console.log,
    console.error
  );
  process.exitCode = exitCode;
}

// Guarded so importing this module — the test does — runs nothing.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
