const DEFAULT_TIMEOUT_MS = 15000;

// fetch with a timeout and human-readable errors
export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...fetchOptions, signal: controller.signal });
    return res;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`Network timeout after ${Math.round(timeoutMs / 1000)}s`);
    }
    if (err instanceof TypeError && (err.message.includes("fetch") || err.message.includes("network"))) {
      throw new Error("Network error — check your connection");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Safely parse JSON from a response, throwing a human-readable error on failure
export async function safeJson<T>(res: Response, label: string): Promise<T> {
  try {
    return await res.json() as T;
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

// Human-readable error for HTTP status codes
export function httpError(label: string, status: number): Error {
  if (status === 429) return new Error(`${label} — rate limited (429)`);
  if (status === 401 || status === 403) return new Error(`${label} — unauthorized (${status})`);
  if (status >= 500) return new Error(`${label} — server error (${status})`);
  return new Error(`${label} — HTTP ${status}`);
}
