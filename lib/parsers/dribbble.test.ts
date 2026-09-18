import { afterEach, describe, expect, test, vi } from "vitest";
import { dribbbleParser, parseDribbbleHtml } from "./dribbble";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

const JOB_URL = "https://dribbble.com/jobs/310076-Senior-Creative-Designer";

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "JobPosting",
  title: "Senior Creative Designer",
  description: "<p>Design ads. The range is $120,000 - $150,000 per year.</p>",
  datePosted: "2026-09-11T17:08:30-04:00",
  hiringOrganization: { "@type": "Organization", name: "Jamloop" },
  jobLocation: {
    "@type": "Place",
    address: {
      "@type": "PostalAddress",
      addressLocality: "Austin",
      addressRegion: "TX",
      addressCountry: null,
    },
  },
};

// Mirrors the real page: an inline initialize() block whose values carry HTML
// entities and urls, plus a JSON-LD script.
function jobPage(overrides: { locationType?: string; ld?: unknown } = {}): string {
  const locationType = overrides.locationType ?? "remote_only";
  const ld = overrides.ld === undefined ? JSON_LD : overrides.ld;
  return `<html><head>
    ${ld === null ? "" : `<script type="application/ld+json">${JSON.stringify(ld)}</script>`}
  </head><body>
  <script>
    Dribbble.JobListing.initialize({
      socialLinks: "{&quot;website&quot;=&gt;&quot;http://www.jamloop.com&quot;}",
      locationType: "${locationType}",
      isPreview: false,
      trackingProperties: {
        job_company: "Jamloop",
        job_id: "310076",
        job_location: "Austin, TX",
        job_location_country: "United States",
        job_location_state: "TX",
        job_title: "Senior Creative Designer",
      },
      utm: {}
    })
  </script>
  </body></html>`;
}

function stubFetch(body: string, status = 200): ReturnType<typeof vi.fn> {
  const stub = vi.fn(async () => new Response(body, { status }));
  globalThis.fetch = stub as unknown as typeof globalThis.fetch;
  return stub;
}

describe("parseDribbbleHtml: the inline data block is read first", () => {
  test("the title and the employer come off the tracking properties", () => {
    const fields = parseDribbbleHtml(jobPage());

    expect(fields.raw_title).toBe("Senior Creative Designer");
    expect(fields.raw_company_name).toBe("Jamloop");
  });

  test("the JSON-LD stands in where the inline block names neither", () => {
    const bare = `<html><head><script type="application/ld+json">${JSON.stringify(
      JSON_LD
    )}</script></head><body></body></html>`;

    const fields = parseDribbbleHtml(bare);

    expect(fields.raw_title).toBe("Senior Creative Designer");
    expect(fields.raw_company_name).toBe("Jamloop");
  });
});

describe("parseDribbbleHtml: the work mode is Dribbble's own word, translated", () => {
  test.each([
    ["remote_only", "remote"],
    ["remote", "remote"],
    ["onsite_or_remote", "hybrid"],
    ["onsite_only", "in-person"],
  ])("locationType %s gives %s", (locationType, expected) => {
    expect(parseDribbbleHtml(jobPage({ locationType })).raw_mode_list).toEqual([expected]);
  });

  test("a word Dribbble has not used before gives an empty mode list", () => {
    expect(parseDribbbleHtml(jobPage({ locationType: "somewhere_new" })).raw_mode_list).toEqual([]);
  });
});

describe("parseDribbbleHtml: every place fragment is kept once", () => {
  test("the tracking fragments and the JSON-LD address combine without repeats", () => {
    expect(parseDribbbleHtml(jobPage()).raw_location_list).toEqual([
      "Austin",
      "TX",
      "United States",
    ]);
  });
});

describe("parseDribbbleHtml: the posting date and the description come from the JSON-LD", () => {
  test("the posting date is read", () => {
    expect(parseDribbbleHtml(jobPage()).posting_date).toEqual(
      new Date("2026-09-11T17:08:30-04:00")
    );
  });

  test("the description is written, not merely scanned and thrown away", () => {
    expect(parseDribbbleHtml(jobPage()).description).toBe(
      "<p>Design ads. The range is $120,000 - $150,000 per year.</p>"
    );
  });

  test("a page with no JSON-LD still reads what the inline block holds", () => {
    const fields = parseDribbbleHtml(jobPage({ ld: null }));

    expect(fields.raw_title).toBe("Senior Creative Designer");
    expect(fields.description).toBeUndefined();
  });

  test("JSON-LD that is not valid JSON is ignored rather than thrown over", () => {
    const broken = `<html><head><script type="application/ld+json">{not json}</script></head><body></body></html>`;

    expect(() => parseDribbbleHtml(broken)).not.toThrow();
  });
});

describe("parseDribbbleHtml: the mapper carries nothing its caller owns", () => {
  test.each(["original_url", "resolved_url", "is_parsed"])("no %s is carried", (field) => {
    expect(field in parseDribbbleHtml(jobPage())).toBe(false);
  });
});

describe("dribbbleParser: the job page is fetched and read", () => {
  test("the link it was given is the page it fetches", async () => {
    const stub = stubFetch(jobPage());

    await dribbbleParser.parse({ url: JOB_URL });

    expect(stub.mock.calls[0][0]).toBe(JOB_URL);
  });

  test("AC 9: the request says it is a browser", async () => {
    const stub = stubFetch(jobPage());

    await dribbbleParser.parse({ url: JOB_URL });

    const options = stub.mock.calls[0][1] as { headers?: Record<string, string> };
    expect(options.headers?.["user-agent"]).toMatch(/Mozilla/);
  });

  test("AC 20: a pay range stated only in the description is read out of it", async () => {
    stubFetch(jobPage());

    const fields = await dribbbleParser.parse({ url: JOB_URL });

    expect(fields.raw_salary).toEqual({
      salary_min: 120000,
      salary_max: 150000,
      salary_period: "year",
    });
  });

  test("a page that will not load throws an error naming the status", async () => {
    stubFetch("nope", 503);

    await expect(dribbbleParser.parse({ url: JOB_URL })).rejects.toThrow(/503/);
  });
});

describe("dribbbleParser: the parser names itself", () => {
  test("its name is the one the source priority list uses", () => {
    expect(dribbbleParser.name).toBe("dribbble");
  });
});
