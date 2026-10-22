// The machine runs on US Central time, so a time read or written as local
// rather than UTC lands five hours off and shows. Set before any date is read.
process.env["TZ"] = "America/Chicago";

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { fantasticJobsCollector } from "./fantastic-jobs";
import type { CollectorContext } from "./collector";
import type { SettingsService } from "../services/settings-service";
import type { LastSuccessService } from "../services/last-success-service";
import { fakeSettingsService } from "../services/settings-service.fake";
import { fakeAtsSlugService } from "../services/ats-slug-service.fake";
import { fakeLastSuccessService } from "../services/last-success-service.fake";

const COLLECTOR = "fantastic-jobs";
const REMOTE = "remote";
const AUSTIN = "austin";
const TOKEN_VARIABLE = "FANTASTIC_JOBS_APIFY_TOKEN";
// A token of the shape Apify issues, so a message holding it can be found.
const TOKEN = "apify_api_CollectorUnitToken4Wz9";
const APIFY_HOST = "api.apify.com";

const COLLECTED_AT = new Date("2026-10-10T15:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const AUSTIN_TOWN = "Austin, Texas, United States";

// The settings every test starts from: two real search terms and a blank one,
// one title to skip, one town, both remote labels, a 7-day window and an 8-day
// age limit.
function settingsWith(overrides: Partial<SettingsService> = {}): SettingsService {
  return fakeSettingsService({
    getSearchTerms: async () => ["Product Design", "  ", "UX"],
    getExcludedTitles: async () => ["Director"],
    getSearchTowns: async () => [AUSTIN_TOWN],
    getRemoteLabels: async () => ["Remote OK", "Remote Solely"],
    getSearchWindowDays: async () => 7,
    getExpiryThreshold: async () => 8,
    ...overrides,
  });
}

// Two polled boards with names, one polled board whose company has no name,
// and one known board nothing polls.
function boards() {
  return fakeAtsSlugService(
    [
      { id: "1", slug: "lindawerner", company_id: "c1", parser: "greenhouse", collector: "greenhouse" },
      { id: "2", slug: "quo", company_id: "c2", parser: "lever", collector: "lever" },
      { id: "3", slug: "nameless", company_id: "c3", parser: "ashby", collector: "ashby" },
      { id: "4", slug: "harborview", company_id: "c4", parser: "ashby", collector: null },
    ],
    {},
    { c1: "Linda Werner & Associates", c2: "Quo", c4: "Harborview Health" }
  );
}

function context(overrides: Partial<CollectorContext> = {}): CollectorContext {
  return {
    settings: settingsWith(),
    atsSlugs: boards(),
    limit: Infinity,
    collectedAt: COLLECTED_AT,
    lastSuccesses: fakeLastSuccessService(),
    ...overrides,
  };
}

// One job as the service returns it.
function boughtJob(n: number, fields: Record<string, unknown> = {}) {
  return {
    id: String(1000 + n),
    title: `Product Designer ${n}`,
    organization: `Employer ${n}`,
    url: `https://careers.employer-${n}.example/jobs/${n}`,
    date_posted: "2026-10-08T12:00:00",
    date_created: "2026-10-08T12:30:00",
    locations_derived: [AUSTIN_TOWN],
    countries_derived: ["United States"],
    ai_work_arrangement: "On-site",
    ai_remote_location: null,
    description_text: "Design the product.",
    source_type: "ats",
    ...fields,
  };
}

type Reply = Response | (() => Response);

interface SentSearch {
  search: string;
  url: URL;
  headers: Headers;
  input: Record<string, unknown>;
}

const originalFetch = globalThis.fetch;
let originalToken: string | undefined;

beforeEach(() => {
  originalToken = process.env[TOKEN_VARIABLE];
  process.env[TOKEN_VARIABLE] = TOKEN;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalToken === undefined) delete process.env[TOKEN_VARIABLE];
  else process.env[TOKEN_VARIABLE] = originalToken;
});

function json(body: unknown, status = 201): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function refusal(text: string): Response {
  return new Response(text, { status: 402, headers: { "content-type": "text/plain" } });
}

// Stands in for Apify, answering each search by name. The remote search is the
// one asking for the whole country.
function standIn(replies: Partial<Record<string, Reply>> = {}): SentSearch[] {
  const sent: SentSearch[] = [];
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.host !== APIFY_HOST) throw new Error(`unexpected request to ${url.toString()}`);
    if (typeof init?.body !== "string") throw new Error("an Apify request carried no JSON body");
    const body = JSON.parse(init.body) as Record<string, unknown>;
    const locations = Array.isArray(body["locationSearch"]) ? body["locationSearch"] : [];
    const search = locations.includes("United States") ? REMOTE : AUSTIN;
    sent.push({ search, url, headers: new Headers(init.headers), input: body });
    const reply = replies[search] ?? json([]);
    return typeof reply === "function" ? reply() : reply;
  };
  return sent;
}

const inputOf = (sent: SentSearch[], search: string) => {
  const found = sent.find((entry) => entry.search === search);
  if (!found) throw new Error(`no ${search} search was sent`);
  return found.input;
};

// The start date as sent, to the second, however its end is spelled.
const startOf = (sent: SentSearch[], search: string) =>
  String(inputOf(sent, search)["datePostedAfter"]).replace(/(\.\d+)?Z?$/, "");
const utcToTheSecond = (date: Date) => date.toISOString().slice(0, 19);

async function savedTimes(times: Partial<Record<string, Date>>): Promise<LastSuccessService> {
  const service = fakeLastSuccessService();
  for (const [search, at] of Object.entries(times)) {
    if (at) await service.record(COLLECTOR, search, at);
  }
  return service;
}

describe("what it sends", () => {
  test("runs the remote search, then the Austin search", async () => {
    const sent = standIn();
    await fantasticJobsCollector.collect(context());
    expect(sent.map((entry) => entry.search)).toEqual([REMOTE, AUSTIN]);
  });

  test("the remote search asks for remote-labelled jobs in the United States", async () => {
    const sent = standIn();
    await fantasticJobsCollector.collect(context());
    const input = inputOf(sent, REMOTE);
    expect(input["locationSearch"]).toEqual(["United States"]);
    expect(input["aiWorkArrangementFilter"]).toEqual(["Remote OK", "Remote Solely"]);
  });

  test("the Austin search asks for the listed towns with no work-arrangement filter", async () => {
    const sent = standIn();
    await fantasticJobsCollector.collect(context());
    const input = inputOf(sent, AUSTIN);
    expect(input["locationSearch"]).toEqual([AUSTIN_TOWN]);
    expect(input["aiWorkArrangementFilter"]).toBeUndefined();
  });

  test("asks for the search terms and skips the titles to skip, each as a prefix, blanks dropped", async () => {
    const sent = standIn();
    await fantasticJobsCollector.collect(context());
    expect(sent).toHaveLength(2);
    for (const entry of sent) {
      expect(entry.input["titleSearch"]).toEqual(["Product Design:*", "UX:*"]);
      expect(entry.input["titleExclusionSearch"]).toEqual(["Director:*"]);
    }
  });

  test("leaves out every polled company with a name, and no other", async () => {
    const sent = standIn();
    await fantasticJobsCollector.collect(context());
    expect(sent).toHaveLength(2);
    for (const entry of sent) {
      expect([...(entry.input["organizationExclusionSearch"] as string[])].sort()).toEqual([
        "Linda Werner & Associates",
        "Quo",
      ]);
    }
  });

  test("sends the fixed operating values", async () => {
    const sent = standIn();
    await fantasticJobsCollector.collect(context());
    expect(sent).toHaveLength(2);
    for (const entry of sent) {
      expect(entry.input["removeAgency"]).toBe(true);
      expect(entry.input["descriptionType"]).toBe("text");
      expect(entry.input["limit"]).toBe(200);
      expect(entry.input["timeRange"]).toBe("7d");
      expect(entry.url.searchParams.get("timeout")).toBe("240");
      expect(Number(entry.url.searchParams.get("maxTotalChargeUsd"))).toBe(2.5);
      expect(entry.url.pathname).toContain("fantastic-jobs~career-site-job-listing-api");
      expect(entry.headers.get("authorization")).toContain(TOKEN);
      expect(entry.url.toString()).not.toContain(TOKEN);
    }
  });

  test("a 1-day window asks for the service's 24-hour window", async () => {
    const sent = standIn();
    await fantasticJobsCollector.collect(
      context({ settings: settingsWith({ getSearchWindowDays: async () => 1 }) })
    );
    expect(sent).toHaveLength(2);
    for (const entry of sent) expect(entry.input["timeRange"]).toBe("24h");
  });
});

describe("how far back it looks", () => {
  test("a search that never worked looks back the shorter of the window and the age limit, in UTC", async () => {
    const sent = standIn();
    await fantasticJobsCollector.collect(context());
    const expected = utcToTheSecond(new Date(COLLECTED_AT.getTime() - 7 * DAY_MS));
    expect(startOf(sent, REMOTE)).toBe(expected);
    expect(startOf(sent, AUSTIN)).toBe(expected);
  });

  test("a search that worked looks back from 24 hours before that time", async () => {
    const remoteAt = new Date("2026-10-09T15:00:00.000Z");
    const austinAt = new Date("2026-10-08T09:00:00.000Z");
    const sent = standIn();
    await fantasticJobsCollector.collect(
      context({ lastSuccesses: await savedTimes({ [REMOTE]: remoteAt, [AUSTIN]: austinAt }) })
    );
    expect(startOf(sent, REMOTE)).toBe(utcToTheSecond(new Date(remoteAt.getTime() - DAY_MS)));
    expect(startOf(sent, AUSTIN)).toBe(utcToTheSecond(new Date(austinAt.getTime() - DAY_MS)));
  });

  test("never looks back past the shorter of the window and the age limit", async () => {
    // 24 hours before this is further back than the 7-day window.
    const longAgo = new Date("2026-10-03T20:00:00.000Z");
    const sent = standIn();
    await fantasticJobsCollector.collect(
      context({ lastSuccesses: await savedTimes({ [REMOTE]: longAgo }) })
    );
    expect(startOf(sent, REMOTE)).toBe(utcToTheSecond(new Date(COLLECTED_AT.getTime() - 7 * DAY_MS)));

    const shortAgeLimit = standIn();
    await fantasticJobsCollector.collect(
      context({
        settings: settingsWith({ getExpiryThreshold: async () => 3 }),
        lastSuccesses: await savedTimes({ [REMOTE]: longAgo }),
      })
    );
    expect(startOf(shortAgeLimit, REMOTE)).toBe(
      utcToTheSecond(new Date(COLLECTED_AT.getTime() - 3 * DAY_MS))
    );
  });
});

describe("what it hands back", () => {
  test("a job carries the service's link as both links and arrives resolved", async () => {
    standIn({ [REMOTE]: json([boughtJob(1)]) });
    const { jobs } = await fantasticJobsCollector.collect(context());
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      original_url: "https://careers.employer-1.example/jobs/1",
      resolved_url: "https://careers.employer-1.example/jobs/1",
      raw_title: "Product Designer 1",
      raw_company_name: "Employer 1",
      description: "Design the product.",
      is_resolved: true,
      is_parsed: false,
      is_classified: false,
    });
  });

  test("reads the posted time and the first-found time as UTC", async () => {
    standIn({
      [REMOTE]: json([
        boughtJob(1, { date_posted: "2026-09-23T20:11:41", date_created: "2026-09-22T23:02:47" }),
      ]),
    });
    const { jobs } = await fantasticJobsCollector.collect(context());
    expect(jobs[0]?.posting_date?.toISOString()).toBe("2026-09-23T20:11:41.000Z");
    expect(jobs[0]?.posting_updated_date?.toISOString()).toBe("2026-09-22T23:02:47.000Z");
  });

  test("a time that is not a date is left out and the job kept", async () => {
    standIn({ [REMOTE]: json([boughtJob(1, { date_posted: "not a date" })]) });
    const { jobs } = await fantasticJobsCollector.collect(context());
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.posting_date).toBeUndefined();
    expect(jobs[0]?.posting_updated_date?.toISOString()).toBe("2026-10-08T12:30:00.000Z");
  });

  test("a remote job's places are its offices, its remote areas and its country", async () => {
    standIn({
      [REMOTE]: json([
        boughtJob(1, {
          locations_derived: ["Oak Brook, Illinois, United States"],
          countries_derived: ["United States"],
          ai_work_arrangement: "Remote OK",
          ai_remote_location: ["Illinois, United States", "Wisconsin, United States"],
        }),
      ]),
    });
    const { jobs } = await fantasticJobsCollector.collect(context());
    expect(jobs[0]?.raw_location_list).toEqual([
      "Oak Brook, Illinois, United States",
      "Illinois, United States",
      "Wisconsin, United States",
      "United States",
    ]);
    expect(jobs[0]?.raw_mode_list).toEqual(["Remote OK"]);
  });

  test("a job with no remote areas keeps only its offices", async () => {
    standIn({ [AUSTIN]: json([boughtJob(1, { ai_work_arrangement: "Hybrid" })]) });
    const { jobs } = await fantasticJobsCollector.collect(context());
    expect(jobs[0]?.raw_location_list).toEqual([AUSTIN_TOWN]);
    expect(jobs[0]?.raw_mode_list).toEqual(["Hybrid"]);
  });

  test("hands back every job from both searches and names both as worked", async () => {
    standIn({ [REMOTE]: json([boughtJob(1)]), [AUSTIN]: json([boughtJob(2)]) });
    const result = await fantasticJobsCollector.collect(context());
    expect(result.jobs).toHaveLength(2);
    expect(result.workedSearches).toEqual([REMOTE, AUSTIN]);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});

describe("a run with a job limit", () => {
  test("asks for the limit, never fewer than 10, and keeps only the limit", async () => {
    const ten = Array.from({ length: 10 }, (_, n) => boughtJob(n));
    const sent = standIn({ [REMOTE]: json(ten), [AUSTIN]: json(ten) });
    const result = await fantasticJobsCollector.collect(context({ limit: 3 }));
    expect(sent).toHaveLength(2);
    for (const entry of sent) expect(entry.input["limit"]).toBe(10);
    expect(result.jobs).toHaveLength(3);
  });

  test("asks for no more than 200", async () => {
    const sent = standIn();
    await fantasticJobsCollector.collect(context({ limit: 500 }));
    expect(sent).toHaveLength(2);
    for (const entry of sent) expect(entry.input["limit"]).toBe(200);
  });

  test("names no search as worked", async () => {
    standIn({ [REMOTE]: json([boughtJob(1)]) });
    const result = await fantasticJobsCollector.collect(context({ limit: 10 }));
    expect(result.jobs).toHaveLength(1);
    expect(result.workedSearches).toBeUndefined();
  });
});

describe("when it cannot search", () => {
  test("a blank token is one error naming the token, and nothing is sent", async () => {
    process.env[TOKEN_VARIABLE] = "";
    const sent = standIn();
    const result = await fantasticJobsCollector.collect(context());
    expect(sent).toHaveLength(0);
    expect(result.errors).toEqual(["Fantastic.jobs needs FANTASTIC_JOBS_APIFY_TOKEN in the environment."]);
    expect(result.warnings).toEqual([]);
  });

  test("an unknown window is one error naming the value, and nothing is sent", async () => {
    const sent = standIn();
    const result = await fantasticJobsCollector.collect(
      context({ settings: settingsWith({ getSearchWindowDays: async () => 3 }) })
    );
    expect(sent).toHaveLength(0);
    expect(result.errors).toEqual([
      "The Fantastic.jobs window setting holds 3; it must be 1 or 7.",
    ]);
  });

  test("an empty town list skips the Austin search and says nothing of it", async () => {
    const sent = standIn();
    const result = await fantasticJobsCollector.collect(
      context({ settings: settingsWith({ getSearchTowns: async () => [] }) })
    );
    expect(sent.map((entry) => entry.search)).toEqual([REMOTE]);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.workedSearches).toEqual([REMOTE]);
  });

  test("an empty remote-label list skips the remote search", async () => {
    const sent = standIn();
    await fantasticJobsCollector.collect(
      context({ settings: settingsWith({ getRemoteLabels: async () => [] }) })
    );
    expect(sent.map((entry) => entry.search)).toEqual([AUSTIN]);
  });

  test("both lists empty is one error, and nothing is sent", async () => {
    const sent = standIn();
    const result = await fantasticJobsCollector.collect(
      context({
        settings: settingsWith({ getSearchTowns: async () => [], getRemoteLabels: async () => [] }),
      })
    );
    expect(sent).toHaveLength(0);
    expect(result.errors).toEqual([
      "Fantastic.jobs ran no search: the town list and the remote-label list are both empty.",
    ]);
  });
});

describe("when a search fails", () => {
  test("one failed search with a saved time is a warning saying the time was kept", async () => {
    const reply = "Monthly usage hard limit exceeded.";
    standIn({ [REMOTE]: json([boughtJob(1)]), [AUSTIN]: refusal(reply) });
    const result = await fantasticJobsCollector.collect(
      context({ lastSuccesses: await savedTimes({ [AUSTIN]: new Date("2026-10-09T15:00:00.000Z") }) })
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      "Fantastic.jobs Austin search failed: HTTP 402: Monthly usage hard limit exceeded. Its saved time was kept, so the next job search asks again for what it missed.",
    ]);
    expect(result.workedSearches).toEqual([REMOTE]);
    expect(result.jobs).toHaveLength(1);
  });

  test("a failed search that never worked says how many days back the next search looks", async () => {
    standIn({ [AUSTIN]: refusal("Unavailable.") });
    const result = await fantasticJobsCollector.collect(context());
    expect(result.warnings).toEqual([
      "Fantastic.jobs Austin search failed: HTTP 402: Unavailable. It has never worked, so the next job search looks back 7 days.",
    ]);
  });

  test("a lone error item is a failure, and its job is not kept", async () => {
    standIn({ [AUSTIN]: json([{ error: "Invalid advanced search syntax." }]) });
    const result = await fantasticJobsCollector.collect(context());
    expect(result.jobs).toEqual([]);
    expect(result.workedSearches).toEqual([REMOTE]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/^Fantastic\.jobs Austin search failed: Invalid advanced search syntax\./);
  });

  test("a long lone error item is cut to its first 300 characters", async () => {
    const text = "x".repeat(338);
    standIn({ [AUSTIN]: json([{ error: text }]) });
    const result = await fantasticJobsCollector.collect(context());
    expect(result.warnings[0]).toContain(`failed: ${"x".repeat(300)}…`);
    expect(result.warnings[0]).not.toContain("x".repeat(301));
  });

  test("when no search worked, each failed search is its own error", async () => {
    standIn({ [REMOTE]: refusal("Down."), [AUSTIN]: refusal("Down.") });
    const result = await fantasticJobsCollector.collect(context());
    expect(result.warnings).toEqual([]);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toMatch(/^Fantastic\.jobs remote search failed: /);
    expect(result.errors[1]).toMatch(/^Fantastic\.jobs Austin search failed: /);
    expect(result.workedSearches).toEqual([]);
  });

  test("a failed search is an error when the other was not sent", async () => {
    standIn({ [REMOTE]: refusal("Down.") });
    const result = await fantasticJobsCollector.collect(
      context({ settings: settingsWith({ getSearchTowns: async () => [] }) })
    );
    expect(result.warnings).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/^Fantastic\.jobs remote search failed: /);
  });
});

describe("a search that reaches its cap", () => {
  test("warns naming the search and the count, and still counts as worked", async () => {
    const full = Array.from({ length: 200 }, (_, n) => boughtJob(n));
    standIn({ [REMOTE]: json(full) });
    const result = await fantasticJobsCollector.collect(context());
    expect(result.jobs).toHaveLength(200);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/^Fantastic\.jobs remote search returned 200 jobs/);
    expect(result.workedSearches).toEqual([REMOTE, AUSTIN]);
  });
});
