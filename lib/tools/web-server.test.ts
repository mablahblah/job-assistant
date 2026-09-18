import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SchemaProbe } from "../db/schema-check";
import type { PageContents } from "../views/page";
import { createWebServer } from "./web-server";

const EMPTY_PAGE: PageContents = { backlog: [], active: [], disqualified: [], workLog: [] };

function probeThatPasses(name: string): SchemaProbe {
  return { name, read: async () => null };
}

function probeThatFails(name: string): SchemaProbe {
  return {
    name,
    read: async () => {
      throw new Error(`no such table: ${name}`);
    },
  };
}

let printed: string[];

beforeEach(() => {
  printed = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    printed.push(String(line));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Criterion 178. The request library takes a made-up request and hands back a
// response with no port opened, so the page can be proved in a test.
describe("answering a request", () => {
  test("hands back the page", async () => {
    const server = createWebServer({
      readContents: async () => EMPTY_PAGE,
      probes: [probeThatPasses("Job")],
      publicDir: "public",
    });

    const response = await server.respondTo("/");

    expect(response.status).toBe(200);
    expect(response.contentType).toContain("text/html");
    expect(String(response.body)).toContain("<!DOCTYPE html>");
  });

  test("the page holds every list the database held", async () => {
    const server = createWebServer({
      readContents: async () => ({
        ...EMPTY_PAGE,
        backlog: [
          {
            job: { id: "job-1", title: "Senior Product Designer", status: "backlog" },
            company: null,
          },
        ],
      }),
      probes: [probeThatPasses("Job")],
      publicDir: "public",
    });

    const response = await server.respondTo("/");

    expect(String(response.body)).toContain("Senior Product Designer");
  });

  test("an address the dashboard does not serve is not found", async () => {
    const server = createWebServer({
      readContents: async () => EMPTY_PAGE,
      probes: [probeThatPasses("Job")],
      publicDir: "public",
    });

    expect((await server.respondTo("/nothing-here")).status).toBe(404);
  });
});

// Criterion 112. A page that cannot read the database has to say so, or an
// empty backlog and a broken read look exactly alike.
describe("a read that fails while answering", () => {
  test("the page says the database could not be read", async () => {
    const server = createWebServer({
      readContents: async () => {
        throw new Error("no such table: Job");
      },
      probes: [probeThatPasses("Job")],
      publicDir: "public",
    });

    const response = await server.respondTo("/");

    expect(String(response.body).toLowerCase()).toContain("could not be read");
  });

  test("the answer is a page rather than nothing", async () => {
    const server = createWebServer({
      readContents: async () => {
        throw new Error("no such table: Job");
      },
      probes: [probeThatPasses("Job")],
      publicDir: "public",
    });

    const response = await server.respondTo("/");

    expect(response.contentType).toContain("text/html");
  });
});

// Criteria 109, 110 and 111. Every other command checks this before it starts;
// the old dashboard did not, and served an empty page instead of saying why.
describe("starting against a mismatched database", () => {
  test("it never begins answering requests", async () => {
    const server = createWebServer({
      readContents: async () => EMPTY_PAGE,
      probes: [probeThatFails("WorkLogEntry")],
      publicDir: "public",
    });

    expect(await server.start(0)).toBe(false);
  });

  test("it names the tables that failed", async () => {
    const server = createWebServer({
      readContents: async () => EMPTY_PAGE,
      probes: [probeThatFails("Company"), probeThatFails("WorkLogEntry")],
      publicDir: "public",
    });

    await server.start(0);

    expect(printed.join("\n")).toContain("Company, WorkLogEntry");
  });

  // Phase 13 reworded the advice: after the switch over a rebuild destroys
  // real records, so the message names the safe migration command instead.
  test("it names the command that migrates them", async () => {
    const server = createWebServer({
      readContents: async () => EMPTY_PAGE,
      probes: [probeThatFails("Job")],
      publicDir: "public",
    });

    await server.start(0);

    expect(printed.join("\n")).toContain("npm run db:migrate");
  });
});

// A dashboard is opened and closed by hand, so a start that worked has to be
// stoppable without leaving a port held.
describe("starting against a database that matches", () => {
  test("it begins answering requests and stops again", async () => {
    const server = createWebServer({
      readContents: async () => EMPTY_PAGE,
      probes: [probeThatPasses("Job")],
      publicDir: "public",
    });

    expect(await server.start(0)).toBe(true);
    await server.stop();
  });
});

// The stylesheet and the browser script are the only files the dashboard
// serves besides the page itself. Nothing exercised this path, so the page
// could have gone on rendering while arriving unstyled and inert.
describe("serving the stylesheet and the browser script", () => {
  function server() {
    return createWebServer({
      readContents: async () => EMPTY_PAGE,
      probes: [probeThatPasses("Job")],
      publicDir: "public",
    });
  }

  test("the stylesheet is handed back as a stylesheet", async () => {
    const response = await server().respondTo("/styles/styles.css");

    expect(response.status).toBe(200);
    expect(response.contentType).toBe("text/css");
    expect(response.body.length).toBeGreaterThan(0);
  });

  test("the browser script is handed back as a script", async () => {
    const response = await server().respondTo("/scripts/dashboard.js");

    expect(response.status).toBe(200);
    expect(response.contentType).toBe("text/javascript");
    expect(response.body.length).toBeGreaterThan(0);
  });

  test("a file that is not there is not found", async () => {
    const response = await server().respondTo("/styles/no-such-file.css");

    expect(response.status).toBe(404);
  });

  test("a path outside the two folders is not found", async () => {
    const response = await server().respondTo("/private/notes.css");

    expect(response.status).toBe(404);
  });
});

// The two tests below need real files on disk to mean anything. Asking for a
// file that is simply absent returns 404 whether or not the guards exist, so
// a guard could be deleted and a test built that way would still pass. These
// build a folder holding the exact files each guard is supposed to refuse.
describe("what the dashboard refuses to serve", () => {
  let publicDir: string;
  let outsideDir: string;

  beforeEach(() => {
    const root = mkdtempSync(join(tmpdir(), "web-server-public-"));
    publicDir = join(root, "public");
    outsideDir = root;
    mkdirSync(join(publicDir, "styles"), { recursive: true });
    writeFileSync(join(publicDir, "styles", "styles.css"), "body { color: black; }");
    // Inside the served folder, but not a type the dashboard ships. Readable,
    // so only the allowed-types list can be what refuses it.
    writeFileSync(join(publicDir, "styles", "secrets.env"), "APIFY_API_TOKEN=real-token");
    // Outside the served folder and readable, and named .css so the type
    // check passes. Only the climbing-out guard can refuse this one.
    writeFileSync(join(outsideDir, "outside.css"), "body { color: red; }");
  });

  function server() {
    return createWebServer({
      readContents: async () => EMPTY_PAGE,
      probes: [probeThatPasses("Job")],
      publicDir,
    });
  }

  test("a readable file inside the folder is served where its type is shipped", async () => {
    const response = await server().respondTo("/styles/styles.css");

    expect(response.status).toBe(200);
  });

  // Proves the allowed-types list is what refuses this, not the file being
  // absent: the file is there and readable.
  test("a readable file whose type is not shipped is refused", async () => {
    const response = await server().respondTo("/styles/secrets.env");

    expect(response.status).toBe(404);
    expect(String(response.body)).not.toContain("real-token");
  });

  // Proves the climbing-out guard is what refuses this: the file is there,
  // readable, and named so that the type check would let it through.
  test("a readable file outside the folder is refused", async () => {
    // Two levels: one out of `styles`, one out of the served folder itself.
    const response = await server().respondTo("/styles/../../outside.css");

    expect(response.status).toBe(404);
    expect(String(response.body)).not.toContain("color: red");
  });
});
