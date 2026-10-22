const DEFAULT_TIMEOUT_MS = 15000;

// Its own type, so a caller can tell a request that ran out of time apart
// from any other failure. The message is the same text callers always saw.
export class NetworkTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Network timeout after ${Math.round(timeoutMs / 1000)}s`);
    this.name = "NetworkTimeoutError";
  }
}

// fetch with a timeout, so a source that never answers cannot hang a run.
export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...fetchOptions, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new NetworkTimeoutError(timeoutMs);
    }
    // Anything else travels untouched. The original message says more about
    // what went wrong than any rewrite of it would.
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Reads a response as JSON, naming the source when the body is not JSON at all.
export async function safeJson<T>(res: Response, label: string): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

// Turns an HTTP status into a message that says what to do about it.
export function httpError(label: string, status: number): Error {
  if (status === 429) return new Error(`${label} — rate limited (429)`);
  if (status === 401 || status === 403) return new Error(`${label} — unauthorized (${status})`);
  if (status >= 500) return new Error(`${label} — server error (${status})`);
  return new Error(`${label} — HTTP ${status}`);
}
