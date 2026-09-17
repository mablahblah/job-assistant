// A stand-in WebServer for tests that need something of this shape without a
// database, a folder of files, or a port. It records nothing: a test that
// needs to watch a call supplies that one behaviour itself.
import type { WebResponse, WebServer } from "./web-server";

const FIXED_PAGE = "<!DOCTYPE html><html><body><p>Fake dashboard</p></body></html>";

const NOT_FOUND: WebResponse = {
  status: 404,
  contentType: "text/plain; charset=utf-8",
  body: "Not found",
};

export function fakeWebServer(overrides: Partial<WebServer> = {}): WebServer {
  return {
    async respondTo(path: string): Promise<WebResponse> {
      if (path !== "/") return NOT_FOUND;
      return { status: 200, contentType: "text/html; charset=utf-8", body: FIXED_PAGE };
    },
    async start(): Promise<boolean> {
      return true;
    },
    async stop(): Promise<void> {},
    ...overrides,
  };
}
