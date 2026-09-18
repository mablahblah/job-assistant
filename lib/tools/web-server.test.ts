import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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
