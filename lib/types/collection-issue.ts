// An error or a warning, always carrying the collector that produced it.
// Thirteen companies sit behind one ATS collector, so the collector's own
// message is what names the board or search and is never rewritten.
export interface CollectionIssue {
  collector: string;
  message: string;
}
