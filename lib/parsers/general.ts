// The general-purpose job-posting parser. Every dedicated parser is asked
// before this one, and each knows one website; this one knows none. It
// falls back to reading any job page by two general methods only: the
// search-engine job data a site publishes for itself (schema.org JobPosting),
// and, failing that, the page's own main text. It reads only posted date,
// updated date, work mode, location and description — title, employer and
// pay are left to the collector, which already has them from the job list.
//
// A browser is the pipeline's most expensive step, so it is opened only when
// a plain fetch finds neither job data nor job text on the page. robots.txt
// is not checked here, because this parser only ever opens the job's own
// posting page — never crawls the site.
//
// A posting is dead only when its own page says so: not found, gone, or an
// address announcing an error, or — after a browser has also found nothing —
// no job showing at all. It is never called dead from the job data's end
// date, which sites commonly leave as a placeholder rather than a fact.
import { fetchPageAnswer } from "../tools/page-fetcher";
import { httpError } from "../utils/fetch-utils";
import { jobFieldsFromJobPosting, jobPostingFromHtml } from "../utils/job-posting-data";
import { jobFieldsFromPageText } from "../utils/page-text";
import { urlAnnouncesError } from "../utils/url-error-flag";
import type { Parser, ParseResult, ParsedFields } from "./parser";

// The one place that reads job fields out of a page's HTML, tried first
// against the plain-fetched page and, if needed, again against the
// browser-rendered one — so this reading logic exists only once.
function readJobFields(html: string, referenceInstant: Date): ParsedFields | null {
  const posting = jobPostingFromHtml(html);
  if (posting) return jobFieldsFromJobPosting(posting);

  const fieldsFromText = jobFieldsFromPageText(html, referenceInstant);
  if (!fieldsFromText) return null;

  // When locations come from page text, hand them back under added_location_list
  // instead of raw_location_list to indicate they are added to, not replacing,
  // the job's own places
  const { raw_location_list, ...rest } = fieldsFromText;
  if (raw_location_list) {
    return { ...rest, added_location_list: raw_location_list };
  }
  return rest;
}

export const generalParser: Parser<ParseResult> = {
  name: "general",
  async parse({ url, readRenderedPage, referenceInstant }) {
    const answer = await fetchPageAnswer(url);

    // Not found or gone: the site itself says the posting is dead, whatever
    // job data the page still carries.
    if (answer.status === 404 || answer.status === 410) return { dead: true };

    // Landed on an address that flags an error (redirected off the posting),
    // regardless of the HTTP status that address answers with.
    if (urlAnnouncesError(answer.url)) return { dead: true };

    // Any other non-success answer is a refusal to read, not evidence the
    // posting is gone — 403, 429, and 5xx all throw rather than report dead.
    if (answer.status < 200 || answer.status >= 300) {
      throw httpError(url, answer.status);
    }

    const instant = referenceInstant ?? new Date();

    const plainFields = readJobFields(answer.html, instant);
    if (plainFields) return plainFields;

    // A plain fetch found nothing. Without a browser there isn't enough
    // evidence to call the page dead — some sites render everything
    // client-side — so this reports nothing read rather than dead.
    if (!readRenderedPage) return {};

    const renderedHtml = await readRenderedPage(url);
    const renderedFields = readJobFields(renderedHtml, instant);
    if (renderedFields) return renderedFields;

    // The page loaded fine, even in a browser, and still shows no job.
    return { dead: true };
  },
};
