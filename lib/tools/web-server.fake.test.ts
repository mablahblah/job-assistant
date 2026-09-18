import { describe, expect, test } from "vitest";
import { fakeWebServer } from "./web-server.fake";

// The stand-in has to answer the same shape the real tool does, or a test
// trusting it proves nothing about the real one.
describe("fakeWebServer", () => {
  test("answers the dashboard's address with a page", async () => {
    const response = await fakeWebServer().respondTo("/");

    expect(response.status).toBe(200);
    expect(response.contentType).toContain("text/html");
    expect(String(response.body)).toContain("<!DOCTYPE html>");
  });

  test("answers anything else with not found", async () => {
    expect((await fakeWebServer().respondTo("/nothing-here")).status).toBe(404);
  });

  test("starts and stops without opening a port", async () => {
    const server = fakeWebServer();

    expect(await server.start(0)).toBe(true);
    await server.stop();
  });

  // A test proving what a command does when the dashboard refuses to start
  // needs a refusal, and no array can produce a real one.
  test("a supplied behaviour wins over the stand-in's own", async () => {
    const server = fakeWebServer({ start: async () => false });

    expect(await server.start(0)).toBe(false);
  });
});
