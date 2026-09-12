// Reads a web address's query string for a signal that the page it points at
// is not the posting it appears to be. Resolution already reads HTTP status,
// but a status code is not the only way a job board says "this one is gone":
// some redirect to a general board listing, answer 200, and record the
// substitution only in the address.
//
// Measured on a real run, a job from uiuxjobsboard resolved to
// https://job-boards.greenhouse.io/gusto?error=true — a page rendering that
// employer's entire 95-job board, with no wording anywhere in its body saying
// anything was wrong. The query string was the only place the failure showed.
//
// A rule may read a list of hosts and may never contain one, so nothing here
// names greenhouse or any other site. It reads a parameter literally named
// "error", which is why it keeps working for boards nobody has looked at yet.
export function urlAnnouncesError(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // An address that cannot be parsed is evidence of nothing. Calling it an
    // announced error would throw away a real posting on the strength of a
    // broken address rather than a broken job.
    return false;
  }

  const value = parsed.searchParams.get("error");
  if (value === null) return false;

  // "false", "0" and "" are how a yes-or-no query parameter spells no, the
  // last being what a template leaves behind when the flag is present but
  // never filled in. Anything else present is taken as yes, whatever wording
  // the board chose, because this only has to notice the flag was set.
  return value !== "false" && value !== "0" && value !== "";
}
