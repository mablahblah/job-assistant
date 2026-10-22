// A service's reply can be long. Past this many characters it is cut short.
const MAX_REPLY_LENGTH = 300;

// Trimmed before cutting, so spaces around a reply never count toward the limit.
export function shortReply(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MAX_REPLY_LENGTH ? `${trimmed.slice(0, MAX_REPLY_LENGTH)}…` : trimmed;
}
