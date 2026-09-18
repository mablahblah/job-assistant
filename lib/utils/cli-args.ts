// Reads a `--name value` pair off the command line. Undefined when the flag
// is absent, so the caller decides what that means — some commands refuse,
// some carry on without it.
//
// Shared rather than copied. Five commands each held a byte-for-byte copy of
// this, so a change to how an option is read had five places to reach and
// missing one would be silent.
export function flagValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return argv[index + 1];
}
