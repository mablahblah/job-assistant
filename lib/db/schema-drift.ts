// The check every command runs before it reads or writes anything, and the
// three lines it prints when the database and the code disagree.
//
// Stopping here is the whole point. A database the code cannot read does not
// fail loudly on its own: the trace service swallows every write it cannot
// make, so a run would work for minutes and end with no record of having done
// it. Stopping costs nothing; going on costs the run.
//
// It reads each table whole and reports only the table's name, which is why
// the message names tables rather than columns.
//
// Shared rather than copied. Five commands each held a byte-for-byte copy, so
// the wording a user sees had five places to change and missing one would
// leave two commands explaining the same fault differently.
import { modelsFailingSchemaCheck, type SchemaProbe } from "./schema-check";

export async function schemaHasDrifted(
  probes: SchemaProbe[],
  print: (line: string) => void = console.log
): Promise<boolean> {
  const drifted = await modelsFailingSchemaCheck(probes);
  if (drifted.length === 0) return false;

  print("The database does not match the schema this code expects.");
  print(`Tables that could not be read: ${drifted.join(", ")}`);
  print("Migrate it with: npm run db:migrate");
  return true;
}
