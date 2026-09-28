// A stand-in for every website `page-fetcher.ts` and the rendered-page browser
// reach, so a flow test can serve job pages without a single request leaving
// the machine. One local web
// server holds a page for each host and path a test writes. The app's plain
// requests reach it through a swapped global fetch, and a real browser reaches
// it because it is launched to find every host name on this machine.
//
// Every request is recorded with who made it, so a test can prove that a page
// was read without a browser, or never asked for at all.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, type Browser } from "playwright";

// How one address answers. A page answers 200 with HTML unless it says
// otherwise. A redirect answers 302 to the address given. A page that hangs
// never answers at all, which is how a page that never stops loading keeps its
// connections open.
export interface SitePage {
  status?: number;
  contentType?: string;
  body?: string;
  redirectTo?: string;
  hang?: boolean;
}

// One request the sites received. A plain request arrives through the swapped
// fetch; anything else came from the browser.
export interface SiteVisit {
  host: string;
  path: string;
  via: "fetch" | "browser";
}

export interface FakePageFetcher {
  // Starts the server. The port is known only after this.
  start(): Promise<void>;
  stop(): Promise<void>;
  // The port every host answers on. A browser keeps a link's port, so a link a
  // browser opens has to carry this one.
  port(): number;
  // Swapped in for global fetch. It sends every request here, whatever host
  // it names, and follows redirects itself so the address a response reports
  // is the one the app asked for rather than this machine's.
  fetch: typeof fetch;
  // Launches a real headless browser that finds every host name on this
  // machine. The number of launches is counted.
  launchBrowser(): Promise<Browser>;
  launches(): number;
  visits: SiteVisit[];
}

// A page is found by its host and its path, query included:
// "careers.northwind.example/jobs/1?ref=feed".
export type SitePages = Record<string, SitePage>;

// Headers the swapped fetch adds, so the server knows which host was asked
// for and that the request did not come from the browser.
const HOST_HEADER = "x-fake-host";
const VIA_HEADER = "x-fake-via";

const MAX_REDIRECTS = 10;

const NOT_FOUND: SitePage = { status: 404, contentType: "text/plain", body: "Not found" };

function hostWithoutPort(host: string): string {
  return host.replace(/:\d+$/, "");
}

export function fakePageFetcher(pages: SitePages): FakePageFetcher {
  const visits: SiteVisit[] = [];
  const realFetch = globalThis.fetch;
  let server: Server | null = null;
  let launchCount = 0;

  const port = (): number => {
    if (server === null) throw new Error("the job sites have not been started");
    return (server.address() as AddressInfo).port;
  };

  function answer(request: IncomingMessage, response: ServerResponse): void {
    const askedHost = request.headers[HOST_HEADER];
    const host = hostWithoutPort(
      typeof askedHost === "string" ? askedHost : (request.headers.host ?? "")
    );
    const path = request.url ?? "/";
    visits.push({ host, path, via: request.headers[VIA_HEADER] === "fetch" ? "fetch" : "browser" });

    const page = pages[`${host}${path}`] ?? NOT_FOUND;
    if (page.hang) return;

    if (page.redirectTo !== undefined) {
      response.writeHead(page.status ?? 302, { location: page.redirectTo });
      response.end();
      return;
    }

    response.writeHead(page.status ?? 200, {
      "content-type": page.contentType ?? "text/html; charset=utf-8",
    });
    response.end(page.body ?? "");
  }

  async function routedFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    let url = new URL(input instanceof Request ? input.url : String(input));
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set(VIA_HEADER, "fetch");

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      headers.set(HOST_HEADER, url.hostname);
      const response = await realFetch(`http://127.0.0.1:${port()}${url.pathname}${url.search}`, {
        ...init,
        headers,
        redirect: "manual",
      });

      const location = response.headers.get("location");
      const isRedirect = response.status >= 300 && response.status < 400 && location !== null;
      if (isRedirect && init?.redirect !== "manual") {
        url = new URL(location, url);
        continue;
      }

      // A real response reports the address it ended on, and code reading a
      // redirect's landing place reads it from here.
      Object.defineProperty(response, "url", { value: url.toString() });
      return response;
    }

    throw new Error(`too many redirects from ${String(input)}`);
  }

  return {
    visits,
    port,
    fetch: routedFetch as typeof fetch,

    async start() {
      server = createServer(answer);
      await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    },

    async stop() {
      if (server === null) return;
      // A hanging page holds its connection open forever, so connections are
      // cut rather than waited on.
      server.closeAllConnections();
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = null;
    },

    async launchBrowser() {
      launchCount += 1;
      return chromium.launch({
        headless: true,
        args: ["--host-resolver-rules=MAP * 127.0.0.1"],
      });
    },

    launches: () => launchCount,
  };
}
