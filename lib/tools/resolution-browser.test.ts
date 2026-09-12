import { describe, expect, test } from "vitest";
import {
  createResolutionBrowser,
  HEADED_LAUNCH_OPTIONS,
  type BrowserLauncher,
  type LaunchedBrowser,
  type LaunchedContext,
} from "./resolution-browser";
import { fakeResolutionPage } from "../resolution-page.fake";

// A stand-in for what Playwright's chromium.launch hands back, recording what
// the tool asked it to do. The real thing opens a window and holds the
// machine, so the tool takes its launcher as an argument and these tests hand
// it this instead.
interface LaunchRecord {
  launches: number;
  contextsOpened: number;
  contextsClosed: number;
  browsersClosed: number;
  launch: BrowserLauncher;
}

function recordingLauncher(): LaunchRecord {
  const record: LaunchRecord = {
    launches: 0,
    contextsOpened: 0,
    contextsClosed: 0,
    browsersClosed: 0,
    launch: async () => {
      record.launches += 1;
      const browser: LaunchedBrowser = {
        async newContext(): Promise<LaunchedContext> {
          record.contextsOpened += 1;
          return {
            async newPage() {
              return fakeResolutionPage([{ url: "https://example.com/job" }]);
            },
            async close() {
              record.contextsClosed += 1;
            },
          };
        },
        async close() {
          record.browsersClosed += 1;
        },
      };
      return browser;
    },
  };
  return record;
}

describe("AC 14: the resolution browser launches once and gives each job its own context", () => {
  test("one browser is launched for the whole run, however many pages it serves", async () => {
    const record = recordingLauncher();
    const session = await createResolutionBrowser(record.launch);

    await session.openPage();
    await session.openPage();
    await session.openPage();

    expect(record.launches).toBe(1);
  });

  test("every page comes from a context of its own, so no job inherits another's cookies", async () => {
    const record = recordingLauncher();
    const session = await createResolutionBrowser(record.launch);

    await session.openPage();
    await session.openPage();

    expect(record.contextsOpened).toBe(2);
  });

  test("closing one job's page closes that job's context and leaves the browser open", async () => {
    const record = recordingLauncher();
    const session = await createResolutionBrowser(record.launch);

    const opened = await session.openPage();
    await opened.close();

    expect(record.contextsClosed).toBe(1);
    expect(record.browsersClosed).toBe(0);
  });

  test("closing the session closes the browser", async () => {
    const record = recordingLauncher();
    const session = await createResolutionBrowser(record.launch);

    await session.close();

    expect(record.browsersClosed).toBe(1);
  });

  test("the open page hands back the page the context opened", async () => {
    const record = recordingLauncher();
    const session = await createResolutionBrowser(record.launch);

    const opened = await session.openPage();
    const response = await opened.page.goto("https://example.com/anything");

    expect(response?.status()).toBe(200);
    expect(opened.page.url()).toBe("https://example.com/job");
  });

  // The mode is deliberately not configurable: measured, Adzuna's redirector
  // refused every headless request and none of the headed ones. Stating it as
  // a constant is what lets a test say so without opening a window.
  test("the browser this tool launches is headed", () => {
    expect(HEADED_LAUNCH_OPTIONS.headless).toBe(false);
  });
});
