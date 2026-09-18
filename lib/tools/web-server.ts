// The thing that answers a browser asking for the dashboard. A tool rather
// than a service: it wraps the port it listens on and the request library
// behind it, both of which sit outside the app.
//
// Answering a request is kept apart from listening on a port, so a made-up
// request can prove the page in a test with no port opened.
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, join } from "node:path";
import { modelsFailingSchemaCheck, type SchemaProbe } from "../db/schema-check";
import { escapeHtml } from "../utils/escape-html";
import { pageView, type PageContents } from "../views/page";

export interface WebResponse {
  status: number;
  contentType: string;
  body: string | Buffer;
}

export interface WebServer {
  // Answers one request with no port involved.
  respondTo(path: string): Promise<WebResponse>;
  // Checks the database matches the code before listening. Returns false,
  // having printed why, when it does not.
  start(port: number): Promise<boolean>;
  stop(): Promise<void>;
}

export interface WebServerOptions {
  readContents: () => Promise<PageContents>;
  probes: SchemaProbe[];
  publicDir: string;
}

const NOT_FOUND: WebResponse = {
  status: 404,
  contentType: "text/plain; charset=utf-8",
  body: "Not found",
};

// The only two kinds of file the dashboard ships. Anything else under those
// folders is not ours to serve.
const STATIC_CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css",
  ".js": "text/javascript",
};

// A blank browser tab says nothing about what went wrong, and an empty page
// reads exactly like an empty backlog. This names the database instead.
function unreadableDatabasePage(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Job Assistant</title></head>
<body>
<h1>The database could not be read</h1>
<p>${escapeHtml(message)}</p>
</body>
</html>`;
}

export function createWebServer(options: WebServerOptions): WebServer {
  const { readContents, probes, publicDir } = options;
  let server: Server | undefined;

  async function staticFile(path: string): Promise<WebResponse> {
    const contentType = STATIC_CONTENT_TYPES[extname(path)];
    if (!contentType) return NOT_FOUND;

    try {
      return { status: 200, contentType, body: await readFile(join(publicDir, path)) };
    } catch {
      return NOT_FOUND;
    }
  }

  async function respondTo(path: string): Promise<WebResponse> {
    // A path climbing out of the public folder would read any file on the
    // machine, so it is refused before anything is opened.
    if (path.includes("..")) return NOT_FOUND;

    if (path === "/") {
      try {
        return {
          status: 200,
          contentType: "text/html; charset=utf-8",
          body: pageView(await readContents()),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          status: 500,
          contentType: "text/html; charset=utf-8",
          body: unreadableDatabasePage(message),
        };
      }
    }

    if (path.startsWith("/styles/") || path.startsWith("/scripts/")) {
      return staticFile(path);
    }

    return NOT_FOUND;
  }

  async function start(port: number): Promise<boolean> {
    // Checked before listening rather than on the first request. A dashboard
    // that starts and then serves an empty page cannot be told apart from an
    // empty backlog, which is the mistake the old one made.
    const failing = await modelsFailingSchemaCheck(probes);
    if (failing.length > 0) {
      console.log("The database does not match the schema this code expects.");
      console.log(`Tables that could not be read: ${failing.join(", ")}`);
      console.log("Migrate it with: npm run db:migrate");
      return false;
    }

    return new Promise((resolve) => {
      // Everything goes through respondTo, so the path a browser takes and
      // the path a test takes cannot become two different behaviours.
      server = createServer((request, response) => {
        void respondTo(request.url ?? "/").then((answer) => {
          response.writeHead(answer.status, { "Content-Type": answer.contentType });
          response.end(answer.body);
        });
      });
      server.listen(port, () => {
        console.log(`Dashboard running at http://localhost:${port}`);
        resolve(true);
      });
    });
  }

  async function stop(): Promise<void> {
    if (!server?.listening) return;
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => (error ? reject(error) : resolve()));
    });
  }

  return { respondTo, start, stop };
}
