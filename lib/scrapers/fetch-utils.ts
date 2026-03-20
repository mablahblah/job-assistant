import { chromium, type Page } from "playwright";

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

// --- Salary formatting ---

// Formats min/max salary to project convention: "$150-188k", "$120k+", "up to $200k", or "?" when unknown
export function formatSalary(min?: number, max?: number, period?: string): string {
  if (!min && !max) return "?";
  const isAnnual = !period || period === "YEAR";
  const k = (n: number) => Math.round(n / 1000);
  // non-annual salaries (hourly, monthly) display raw with the period label
  const fmt = (n: number) => (isAnnual ? `$${k(n)}k` : `$${n}/${period!.toLowerCase()}`);

  if (min && max) return isAnnual ? `$${k(min)}-${k(max)}k` : `${fmt(min)}-${fmt(max)}`;
  if (min) return `${fmt(min)}+`;
  if (max) return `up to ${fmt(max)}`;
  return "?";
}

// --- Work mode detection ---

// Detects work mode from free-form text (HTML content, descriptions, titles, locations)
export function detectWorkModeFromText(text: string, defaultMode: string = ""): string {
  const lower = text.toLowerCase();
  if (lower.includes("in-person") || lower.includes("on-site") || lower.includes("onsite") || lower.includes("in office")) {
    return "in-person";
  }
  if (lower.includes("hybrid")) return "hybrid";
  if (lower.includes("remote")) return "remote";
  return defaultMode;
}

// Detects work mode from structured data (API enums, JSON-LD fields)
export function detectWorkModeFromData(fields: {
  workplaceType?: string;
  jobLocationType?: string;
  jobBenefits?: string;
  isRemote?: boolean;
}): string {
  // boolean remote flag (e.g. JSearch)
  if (fields.isRemote === true) return "remote";
  if (fields.isRemote === false) return "";

  // enum value (e.g. Lever workplaceType)
  const type = fields.workplaceType?.toLowerCase();
  if (type === "remote") return "remote";
  if (type === "hybrid") return "hybrid";
  if (type === "on-site" || type === "onsite") return "in-person";

  // JSON-LD fields (e.g. WeLoveProduct)
  const locationType = (fields.jobLocationType || "").toLowerCase();
  const benefits = (fields.jobBenefits || "").toLowerCase();
  if (locationType.includes("remote") || benefits.includes("remote")) return "remote";
  if (locationType.includes("hybrid") || benefits.includes("hybrid")) return "hybrid";

  return "";
}

// --- Text-based salary extraction ---

// Decode HTML entities (handles double-encoded content like &amp;mdash; → &mdash; → —)
export function decodeHtmlEntities(html: string): string {
  let text = html;
  for (let i = 0; i < 3; i++) {
    const prev = text;
    text = text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&mdash;/g, "—")
      .replace(/&ndash;/g, "–");
    if (text === prev) break;
  }
  return text;
}

// Extract salary range from free-form text/HTML, output as "$81-91k" or "?" when not found
export function parseSalaryFromText(text: string): string {
  // Decode entities and strip HTML tags
  const clean = decodeHtmlEntities(text)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
  const pattern = /\$([\d,]+)(?:\.\d+)?\s*[-–—to]+\s*\$?([\d,]+)(?:\.\d+)?/i;
  const match = clean.match(pattern);
  if (!match) return "?";
  const toK = (s: string) => Math.round(Number(s.replace(/,/g, "")) / 1000);
  return `$${toK(match[1])}-${toK(match[2])}k`;
}

// --- Query filtering ---

// Returns true if any query matches the text (case-insensitive substring)
export function matchesQuery(text: string, queries: string[]): boolean {
  const lower = text.toLowerCase();
  return queries.some((q) => lower.includes(q.toLowerCase()));
}

// --- JSON-LD parsing ---

// Shape of a JobPosting JSON-LD node (subset of fields we care about)
export interface JobPostingLD {
  datePosted?: string;
  jobBenefits?: string;
  jobLocationType?: string;
  baseSalary?: {
    value?: { minValue?: number; maxValue?: number };
  };
  jobLocation?: {
    address?: { addressLocality?: string; addressRegion?: string; addressCountry?: string };
  };
  description?: string;
}

// Extracts the first JobPosting JSON-LD node from a Playwright page's <script> tags
export async function parseJobPostingLD(page: Page): Promise<JobPostingLD> {
  return page.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    for (const script of scripts) {
      try {
        const data = JSON.parse(script.textContent || "");
        // Could be a single object or have @graph array
        const nodes = data["@graph"] || [data];
        for (const node of nodes) {
          if (node["@type"] === "JobPosting") return node;
        }
      } catch { /* skip malformed JSON-LD */ }
    }
    return {};
  });
}

// --- Playwright browser wrapper ---

// Launches a headless browser, runs fn, and guarantees cleanup
export async function withBrowser<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    throw new Error("Browser failed to launch — is Playwright installed? (npx playwright install chromium)");
  }

  try {
    const page = await browser.newPage();
    return await fn(page);
  } finally {
    await browser.close();
  }
}
