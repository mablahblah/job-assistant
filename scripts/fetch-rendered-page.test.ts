import { describe, expect, test } from "vitest";
import { fakeRenderedPageFetcher } from "../lib/tools/rendered-page-fetcher.fake";
import { runFetchRenderedPage } from "./fetch-rendered-page";

// Collects what the command would print, so a test reads output as values
// instead of capturing process streams.
function collect() {
  const lines: string[] = [];
  return { lines, write: (line: string) => lines.push(line) };
}

const URL = "https://example.com/job/123";
const HTML = "<html><body>Rendered job posting</body></html>";

describe("fetching a rendered page", () => {
  test("prints the finished page for --url and exits clean", async () => {
    const out = collect();
    const err = collect();
    const fetcher = fakeRenderedPageFetcher({ [URL]: HTML });

    const exitCode = await runFetchRenderedPage(["--url", URL], fetcher, out.write, err.write);

    expect(exitCode).toBe(0);
    expect(out.lines).toEqual([HTML]);
    expect(err.lines).toEqual([]);
  });

  test("a missing --url is an error naming the flag, and nothing is fetched", async () => {
    const out = collect();
    const err = collect();
    // The fake throws on any fetch, so reaching it at all would surface as a
    // thrown error rather than the flag message this test expects.
    const fetcher = fakeRenderedPageFetcher({});

    const exitCode = await runFetchRenderedPage([], fetcher, out.write, err.write);

    expect(exitCode).toBe(1);
    expect(out.lines).toEqual([]);
    expect(err.lines.join("\n")).toContain("--url");
  });

  test("a fetch that throws is an error exit with no partial page printed", async () => {
    const out = collect();
    const err = collect();
    const fetcher = fakeRenderedPageFetcher({});

    const exitCode = await runFetchRenderedPage(["--url", URL], fetcher, out.write, err.write);

    expect(exitCode).toBe(1);
    expect(out.lines).toEqual([]);
    expect(err.lines.join("\n")).toContain(URL);
  });
});
