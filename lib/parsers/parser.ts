// The shared contract every parser implements, whatever source it reads —
// Greenhouse's API, Lever's, Ashby's, or a scraped Dribbble page. The handler
// knows only this shape and never a parser's internals. A parser finds its
// own job by the domain its source owns, which lives in a separate registry
// rather than on the parser itself.
import type { MappedJobFields } from "../types/job-list-entry";

// What a parser is handed to read one job: the resolved link, and optional
// helpers. readRenderedPage reads a page in a browser the caller already opened
// for the whole job search. referenceInstant is the moment the job search
// measures every age against. Both helpers are optional; only parsers reading
// arbitrary pages need them. The handler holds the original link and phase
// gates — a parser only ever reads the page it is pointed at.
export interface ParserContext {
  url: string;
  readRenderedPage?: (url: string) => Promise<string>;
  referenceInstant?: Date;
}

// A dead posting: the job's own page shows it is gone, so the job can be
// expired. Distinct from failing to read (which throws) or finding nothing
// (which returns {}).
export interface DeadPosting {
  dead: true;
}

// Fields a parse successfully extracted. added_location_list: places a parser
// read from loose page text rather than published data, added to the job's
// own locations instead of replacing them.
export interface ParsedFields extends MappedJobFields {
  added_location_list?: string[];
}

// What a parse hands back. A dead posting marks the job as expired. An empty
// result — no fields at all — is what a parse that read nothing looks like,
// and the handler treats it as a failure, leaving the job in the backlog to
// retry. One field or more is a success: a posting that genuinely publishes
// only a title is thin, not unread.
export type ParseResult = ParsedFields | DeadPosting;

// Result is what this parser's parse() hands back. It defaults to plain job
// fields, which is what every dedicated parser answers — they can never find
// a page dead, only read fields or find none. A parser that can also
// recognise a dead posting declares itself Parser<ParseResult> instead. The
// default keeps Parser assignable to Parser<ParseResult>, so code holding a
// mixed list of parsers can type it Parser<ParseResult> and narrow each
// answer, while a dedicated parser's own tests keep reading fields straight
// off the result.
export interface Parser<Result extends ParseResult = MappedJobFields> {
  // The parser's single canonical name, e.g. "greenhouse". It labels this
  // parser in the source priority list as `parser:greenhouse`, which is what
  // decides whether this parser's value or a collector's survives the save
  // merge.
  name: string;
  // Reads the job at the given link and hands back what it found. A parser
  // that cannot read its source throws; the handler catches per job, so one
  // job's failure never costs the rest of the list.
  parse(context: ParserContext): Promise<Result>;
  // Answers whether this parser recognises a link no registry entry owns.
  // The registry matches by owned domain first and only asks this where that
  // finds nothing, so a parser is never asked about a link another parser
  // already owns. Optional: a parser recognising nothing beyond its own
  // domain leaves it out.
  claims?(url: string): boolean;
}
