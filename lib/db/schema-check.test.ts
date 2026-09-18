import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CHECKED_MODELS,
  modelsFailingSchemaCheck,
  schemaProbesFor,
  type SchemaProbe,
} from "./schema-check";

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

// The check exists because a hand-kept list went stale. Its own list of
// models is hand-kept too, so this reads the schema and holds the two
// together — a model added there and forgotten here would otherwise go
// unchecked for good.
describe("the check covers every model the schema declares", () => {
  function modelsInSchema(): string[] {
    const schemaPath = path.resolve(__dirname, "..", "..", "prisma", "schema.prisma");
    const schema = readFileSync(schemaPath, "utf-8");
    return [...schema.matchAll(/^model (\w+) \{/gm)].map((match) => match[1] ?? "");
  }

  test("no model in the schema is left unchecked", () => {
    expect([...CHECKED_MODELS].sort()).toEqual(modelsInSchema().sort());
  });

  // Naming a model in the list buys nothing unless a probe reads it, so the
  // two are held together here as well.
  test("every checked model has a probe that reads it", () => {
    // Stands in for the client: every table answers a findFirst.
    const db = new Proxy(
      {},
      {
        get() {
          return { findFirst: async () => null };
        },
      }
    ) as Parameters<typeof schemaProbesFor>[0];

    const probes = schemaProbesFor(db);
    expect(probes.map((probe) => probe.name).sort()).toEqual([...CHECKED_MODELS].sort());
  });

  test("the ATS slug table is one of the tables read", async () => {
    const asked: string[] = [];
    const db = new Proxy(
      {},
      {
        get(_target, property) {
          return {
            findFirst: async () => {
              asked.push(String(property));
              return null;
            },
          };
        },
      }
    ) as Parameters<typeof schemaProbesFor>[0];

    const probe = schemaProbesFor(db).find((candidate) => candidate.name === "AtsSlug");
    expect(probe, "no probe named AtsSlug").toBeDefined();
    await probe?.read();
    expect(asked).toEqual(["atsSlug"]);
  });

  // The work log is a legal filing. A command that wrote a status change and
  // then failed to write the entry beside it would leave the user believing a
  // record exists, so the table it lands in is read before the run starts.
  test("the work log table is one of the tables read", async () => {
    const asked: string[] = [];
    const db = new Proxy(
      {},
      {
        get(_target, property) {
          return {
            findFirst: async () => {
              asked.push(String(property));
              return null;
            },
          };
        },
      }
    ) as Parameters<typeof schemaProbesFor>[0];

    const probe = schemaProbesFor(db).find((candidate) => candidate.name === "WorkLogEntry");
    expect(probe, "no probe named WorkLogEntry").toBeDefined();
    await probe?.read();
    expect(asked).toEqual(["workLogEntry"]);
  });
});

// Criterion "No message advises the wipe". After the switch over the real
// database holds records a rebuild would destroy, so every command printing
// the schema-mismatch message has to point at the path that keeps them.
describe("what the recovery messages advise", () => {
  const filesPrintingTheMessage = [
    path.join("lib", "tools", "web-server.ts"),
    path.join("scripts", "find-jobs.ts"),
    path.join("scripts", "change-status.ts"),
    path.join("scripts", "score-save.ts"),
    path.join("scripts", "score-gather.ts"),
    path.join("scripts", "job-search.ts"),
  ];

  test("no command tells the user to rebuild, and each names the safe path", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    for (const file of filesPrintingTheMessage) {
      const source = readFileSync(path.join(repoRoot, file), "utf-8");
      expect(source, `${file} still advises the wipe`).not.toContain("db:create");
      expect(source, `${file} names no safe path`).toContain("npm run db:migrate");
    }
  });
});
