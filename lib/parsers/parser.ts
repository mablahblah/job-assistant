// The shared contract every parser implements, whatever source it reads —
// Greenhouse's API, Lever's, Ashby's, or a scraped Dribbble page. The handler
// knows only this shape and never a parser's internals. A parser finds its
// own job by the domain its source owns, which lives in a separate registry
// rather than on the parser itself.
import type { MappedJobFields } from "../types/job-list-entry";

// What a parser is handed to read one job: the resolved link, and nothing
// else. The handler holds the original link and the phase gates — a parser
// only ever reads the page it is pointed at.
export interface ParserContext {
  url: string;
}

// What a parse hands back. An empty result — no fields at all — is what a
// parse that read nothing looks like, and the handler treats it as a failure,
// leaving the job in the backlog to retry. One field or more is a success:
// a posting that genuinely publishes only a title is thin, not unread.
export type ParseResult = MappedJobFields;

export interface Parser {
  // The parser's single canonical name, e.g. "greenhouse". It labels this
  // parser in the source priority list as `parser:greenhouse`, which is what
  // decides whether this parser's value or a collector's survives the save
  // merge.
  name: string;
  // Reads the job at the given link and hands back what it found. A parser
  // that cannot read its source throws; the handler catches per job, so one
  // job's failure never costs the rest of the list.
  parse(context: ParserContext): Promise<ParseResult>;
  // Answers whether this parser recognises a link no registry entry owns.
  // The registry matches by owned domain first and only asks this where that
  // finds nothing, so a parser is never asked about a link another parser
  // already owns. Optional: a parser recognising nothing beyond its own
  // domain leaves it out.
  claims?(url: string): boolean;
}
