import { describe, expect, test } from "vitest";
import type { Page, Response } from "playwright";
import type { PageAnchor, ResolutionPage, ResolutionResponse } from "./resolution-page";

// These assertions are checked by the typechecker rather than at run time —
// `npm run lint` runs `tsc --noEmit`, and a shape that drifts fails there. The
// run-time bodies exist only so the file is a test file like any other.

describe("ResolutionPage names every method the walk calls", () => {
  test("the interface carries the whole set", () => {
    type CarriesEveryMethod = ResolutionPage extends {
      goto: (url: string, options?: { timeout?: number }) => Promise<ResolutionResponse | null>;
      url: () => string;
      content: () => Promise<string>;
      title: () => Promise<string>;
      $$eval: (selector: string, fn: (elements: PageAnchor[]) => unknown) => Promise<unknown>;
      on: (event: "response", handler: (response: ResolutionResponse) => void) => unknown;
      off: (event: "response", handler: (response: ResolutionResponse) => void) => unknown;
    }
      ? true
      : false;

    const carriesEveryMethod: CarriesEveryMethod = true;
    expect(carriesEveryMethod).toBe(true);
  });
});

describe("ResolutionResponse names every method the walk calls", () => {
  test("the interface carries the whole set", () => {
    type CarriesEveryMethod = ResolutionResponse extends {
      status: () => number;
      url: () => string;
    }
      ? true
      : false;

    const carriesEveryMethod: CarriesEveryMethod = true;
    expect(carriesEveryMethod).toBe(true);
  });
});

describe("a real Playwright page can be handed straight to the walk", () => {
  test("Playwright's Page satisfies ResolutionPage", () => {
    const asResolutionPage = (page: Page): ResolutionPage => page;
    expect(asResolutionPage).toBeTypeOf("function");
  });

  test("Playwright's Response satisfies ResolutionResponse", () => {
    const asResolutionResponse = (response: Response): ResolutionResponse => response;
    expect(asResolutionResponse).toBeTypeOf("function");
  });
});
