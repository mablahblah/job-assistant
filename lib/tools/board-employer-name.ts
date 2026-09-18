// Fetches an ATS board page and reads the employer's name off it.
//
// Reached for when a job's source hands over a board slug but no employer
// name. Ashby's posting API answers with only jobs and apiVersion for some
// boards — measured on 2026-09-12 against the hinge-health board — so the
// name has to come off the board page's title instead.
//
// Deliberately never cached. Search terms narrow each board down to a handful
// of jobs, so the repeated fetch is small, and caching costs nothing to add
// later if that changes.
//
// Shared rather than copied. The Ashby and Lever parsers each held this block
// character for character, including the comment explaining it, so a change
// to what a failed board page costs had two places to reach.
import { fetchPageHtml } from "./page-fetcher";
import { nameFromBoardTitle, titleFromHtml } from "../utils/board-title-name";

export async function employerNameFromBoardPage(
  boardUrl: string,
  // Substituted in tests so the name can be proved without a network request.
  fetchHtml: (url: string) => Promise<string> = fetchPageHtml
): Promise<string | null> {
  try {
    const html = await fetchHtml(boardUrl);
    const title = titleFromHtml(html);
    return title ? nameFromBoardTitle(title) : null;
  } catch {
    // A board page that will not load costs the name, not the parse — a
    // missing employer name is an ordinary state the app already handles.
    return null;
  }
}
