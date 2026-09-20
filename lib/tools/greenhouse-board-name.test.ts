// Six employers host their Greenhouse postings on their own website, so the
// link names no board and the Greenhouse parser has nothing to read. Every one
// of those addresses carries a job number, and Greenhouse's own redirect turns
// that number into the board name.
//
// Guessing the board name from the website was wrong four times out of six —
// measured 2026-09-20, where datavant.com gives datavant2, ats.comparably.com
// gives stashinvest and gladly.ai gives sagansystems — so the redirect is the
// only source worth reading.
import { describe, expect, test } from "vitest";
import { boardNameFromJobId } from "./greenhouse-board-name";

describe("recovering a Greenhouse board name from a job number", () => {
  // Measured 2026-09-20: job number 7994649003 redirects to an address
  // carrying for=moduscreate, which is the board Modus Create hires through.
  test("the board name is read out of the address the redirect lands on", async () => {
    const board = await boardNameFromJobId("7994649003", async () => {
      return "https://job-boards.greenhouse.io/embed/job_app?for=moduscreate&token=7994649003";
    });

    expect(board).toBe("moduscreate");
  });

  // Measured 2026-09-20: a job number Greenhouse no longer holds answers 404
  // and redirects nowhere. A posting can be taken down between being collected
  // and being read, so this is an ordinary state rather than a fault.
  test("a job number that redirects nowhere gives no board name", async () => {
    const board = await boardNameFromJobId("7558673", async () => null);

    expect(board).toBeNull();
  });

  test("an address carrying no board name gives no board name", async () => {
    const board = await boardNameFromJobId("7558673", async () => {
      return "https://boards.greenhouse.io/embed/job_app?token=7558673";
    });

    expect(board).toBeNull();
  });

  test("an address carrying an empty board name gives no board name", async () => {
    const board = await boardNameFromJobId("7558673", async () => {
      return "https://job-boards.greenhouse.io/embed/job_app?for=&token=7558673";
    });

    expect(board).toBeNull();
  });

  // A request that will not complete costs the board name, not the run. The
  // parser turns a missing board name into its own recorded failure, exactly
  // as it does for every other reason a posting cannot be read.
  test("a request that will not complete costs the board name rather than throwing", async () => {
    const board = await boardNameFromJobId("7994649003", async () => {
      throw new Error("the redirect would not complete");
    });

    expect(board).toBeNull();
  });

  test("the job number it was given is the one it asks Greenhouse about", async () => {
    const asked: string[] = [];

    await boardNameFromJobId("7994649003", async (url) => {
      asked.push(url);
      return "https://job-boards.greenhouse.io/embed/job_app?for=moduscreate&token=7994649003";
    });

    expect(asked).toEqual(["https://boards.greenhouse.io/embed/job_app?token=7994649003"]);
  });
});
