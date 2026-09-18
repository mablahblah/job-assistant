// Five commands each held a byte-for-byte copy of this check and its three
// printed lines. One shared version means the wording a user sees, and the
// decision to stop, change in one place rather than five.
import { describe, expect, test } from "vitest";
import { schemaHasDrifted } from "./schema-drift";
import type { SchemaProbe } from "./schema-check";

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

describe("stopping a command when the database and the code disagree", () => {
  test("a database matching the code does not stop the command", async () => {
    const printed: string[] = [];

    const drifted = await schemaHasDrifted([probeThatPasses("Job")], (line) => printed.push(line));

    expect(drifted).toBe(false);
  });

  test("a matching database is silent", async () => {
    const printed: string[] = [];

    await schemaHasDrifted([probeThatPasses("Job")], (line) => printed.push(line));

    expect(printed).toEqual([]);
  });

  test("a table the code cannot read stops the command", async () => {
    const printed: string[] = [];

    const drifted = await schemaHasDrifted([probeThatFails("Trace")], (line) => printed.push(line));

    expect(drifted).toBe(true);
  });

  // The user has to know which table, or the message names a problem they
  // cannot go and look at.
  test("the table that could not be read is named", async () => {
    const printed: string[] = [];

    await schemaHasDrifted([probeThatFails("Trace")], (line) => printed.push(line));

    expect(printed.join("\n")).toContain("Trace");
  });

  test("every unreadable table is named, not just the first", async () => {
    const printed: string[] = [];

    await schemaHasDrifted([probeThatFails("Trace"), probeThatFails("Job")], (line) =>
      printed.push(line)
    );

    expect(printed.join("\n")).toContain("Trace");
    expect(printed.join("\n")).toContain("Job");
  });

  // Naming the way out is the point of stopping here rather than failing
  // somewhere further in.
  test("the command that fixes it is named", async () => {
    const printed: string[] = [];

    await schemaHasDrifted([probeThatFails("Trace")], (line) => printed.push(line));

    expect(printed.join("\n")).toContain("npm run db:migrate");
  });

  test("one readable table among unreadable ones still stops the command", async () => {
    const printed: string[] = [];

    const drifted = await schemaHasDrifted(
      [probeThatPasses("Job"), probeThatFails("Trace")],
      (line) => printed.push(line)
    );

    expect(drifted).toBe(true);
  });
});
