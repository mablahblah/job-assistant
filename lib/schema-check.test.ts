import { describe, expect, test } from "vitest";
import { modelsFailingSchemaCheck, type SchemaProbe } from "./schema-check";

function reads(name: string): SchemaProbe {
  return { name, read: async () => null };
}

function refuses(name: string): SchemaProbe {
  return {
    name,
    read: async () => {
      throw new Error(`SQLITE_ERROR: no such column: main.${name}.something`);
    },
  };
}

describe("the check that the database still matches the code", () => {
  test("a database every table can be read from comes back clean", async () => {
    expect(await modelsFailingSchemaCheck([reads("Job"), reads("Trace")])).toEqual([]);
  });

  // The column that bit us was on one table only, so the check has to name
  // which table failed rather than answer yes or no for the whole database.
  test("a table that cannot be read is named", async () => {
    expect(await modelsFailingSchemaCheck([reads("Job"), refuses("Trace")])).toEqual(["Trace"]);
  });

  // A schema change usually touches more than one table, and a check that
  // stopped at the first would send the user round the loop once per table.
  test("every table that cannot be read is named, not just the first", async () => {
    const failing = await modelsFailingSchemaCheck([
      refuses("Job"),
      reads("Company"),
      refuses("Trace"),
    ]);

    expect(failing).toEqual(["Job", "Trace"]);
  });

  test("a table listed after a failing one is still checked", async () => {
    let reached = false;
    const probes: SchemaProbe[] = [
      refuses("Job"),
      {
        name: "Trace",
        read: async () => {
          reached = true;
          return null;
        },
      },
    ];

    await modelsFailingSchemaCheck(probes);

    expect(reached).toBe(true);
  });

  test("a database with no tables to check comes back clean", async () => {
    expect(await modelsFailingSchemaCheck([])).toEqual([]);
  });
});
