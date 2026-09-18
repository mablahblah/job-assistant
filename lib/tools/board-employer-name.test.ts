// The Ashby and Lever parsers each held this block character for character.
// Only the board address differed, so one shared version takes that as its
// argument and the two parsers stop being able to drift apart on what a
// failed board page costs.
import { describe, expect, test } from "vitest";
import { employerNameFromBoardPage } from "./board-employer-name";

describe("reading an employer's name off its board page", () => {
  test("the name is read out of the page title", async () => {
    const name = await employerNameFromBoardPage("https://jobs.example/acme", async () => {
      return "<html><head><title>Acme Corp Jobs</title></head><body></body></html>";
    });

    expect(name).toBe("Acme Corp");
  });

  // A board page that will not load costs the name, not the parse — a
  // missing employer name is an ordinary state the app already handles.
  test("a page that will not load costs the name rather than throwing", async () => {
    const name = await employerNameFromBoardPage("https://jobs.example/acme", async () => {
      throw new Error("the board page would not load");
    });

    expect(name).toBeNull();
  });

  test("a page carrying no title gives no name", async () => {
    const name = await employerNameFromBoardPage("https://jobs.example/acme", async () => {
      return "<html><head></head><body>No title here</body></html>";
    });

    expect(name).toBeNull();
  });

  test("a title nothing can be read out of gives no name", async () => {
    const name = await employerNameFromBoardPage("https://jobs.example/acme", async () => {
      return "<html><head><title>Jobs</title></head><body></body></html>";
    });

    expect(name).toBeNull();
  });

  test("the address it was given is the one it fetches", async () => {
    const asked: string[] = [];

    await employerNameFromBoardPage("https://jobs.example/acme", async (url) => {
      asked.push(url);
      return "<html><head><title>Acme Corp Jobs</title></head><body></body></html>";
    });

    expect(asked).toEqual(["https://jobs.example/acme"]);
  });
});
