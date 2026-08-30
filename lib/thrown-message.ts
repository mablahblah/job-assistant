// Turns whatever a failure threw into a sentence a person can read.
//
// A thrown value is not guaranteed to be an Error — a request or a browser
// operation can reject with a plain object like { code: "ECONNRESET" }, which
// String() flattens to the useless "[object Object]". Anything that is not an
// Error or a string is rendered as JSON instead, so the cause survives.
//
// Every place that catches an unknown throw calls this one, because a message
// that names nothing is the same failure wherever it is written.
export function messageFromThrown(thrown: unknown): string {
  if (thrown instanceof Error) return thrown.message;
  if (typeof thrown === "string") return thrown;
  if (thrown === undefined) return "undefined";
  if (thrown === null) return "null";
  try {
    return JSON.stringify(thrown);
  } catch {
    // JSON.stringify throws on a circular value. A poor message beats
    // replacing the original failure with a second one.
    return String(thrown);
  }
}
