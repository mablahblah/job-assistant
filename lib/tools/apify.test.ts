import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { runApifyActor, type ApifyRun } from "./apify";

// A token of the shape Apify issues, so a web address holding it would show.
const TOKEN = "apify_api_ToolTestToken4Zx9";

const RUN: ApifyRun = {
  actor: "someone~some-actor",
  input: { titleSearch: ["Product Design:*"], limit: 10 },
  token: TOKEN,
  timeLimitSeconds: 240,
  chargeCapUsd: 2.5,
  waitSeconds: 270,
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain" } });
}

// A reply that never comes. It ends only when the request is called off, the
// way a real request does when its signal aborts.
function neverAnswered(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () =>
      reject(new DOMException("The operation was aborted.", "AbortError"))
    );
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("runApifyActor: the request it sends", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(json([], 201));
    vi.stubGlobal("fetch", fetchMock);
  });

  async function sent(): Promise<{ url: URL; init: RequestInit }> {
    await runApifyActor(RUN);
    const [input, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return { url: new URL(input), init };
  }

  test("it runs the named actor and waits for its items", async () => {
    const { url } = await sent();
    expect(url.host).toBe("api.apify.com");
    expect(url.pathname).toBe("/v2/acts/someone~some-actor/run-sync-get-dataset-items");
  });

  test("it posts the input it is handed as JSON", async () => {
    const { init } = await sent();
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual(RUN.input);
  });

  test("it tells Apify when to stop the run", async () => {
    expect((await sent()).url.searchParams.get("timeout")).toBe("240");
  });

  test("it tells Apify when to stop charging", async () => {
    expect((await sent()).url.searchParams.get("maxTotalChargeUsd")).toBe("2.5");
  });

  test("it sends the token in the Authorization header", async () => {
    const { init } = await sent();
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
  });

  test("it keeps the token out of the web address", async () => {
    expect((await sent()).url.toString()).not.toContain(TOKEN);
  });
});

describe("runApifyActor: what it hands back", () => {
  test("a finished run hands back its items", async () => {
    const items = [{ title: "Product Designer" }, { title: "UX Designer" }];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(items, 201)));

    await expect(runApifyActor(RUN)).resolves.toEqual(items);
  });

  test("a finished run whose answer is not a list fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ items: [] }, 201)));

    await expect(runApifyActor(RUN)).rejects.toThrow();
  });

  test("a refusal fails with its answer code and the service's reply", async () => {
    const reply = "Monthly usage hard limit exceeded. Please upgrade your plan.";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(text(reply, 402)));

    await expect(runApifyActor(RUN)).rejects.toThrow(`402: ${reply}`);
  });

  test("a short reply is shown whole, with nothing added", async () => {
    const reply = "Actor run failed.";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(text(reply, 500)));

    await expect(runApifyActor(RUN)).rejects.toThrow(new RegExp(`${reply}$`));
  });

  test("a reply over 300 characters is cut to its first 300, followed by …", async () => {
    const reply = "Monthly usage hard limit exceeded. ".repeat(9) + "Past the cut.";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(text(reply, 402)));

    const failure = await runApifyActor(RUN).catch((thrown: unknown) => thrown);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message.endsWith(`${reply.slice(0, 300)}…`)).toBe(true);
  });

  test("a run that never answers fails once the wait is over", async () => {
    // The wait runs on a timer the test can advance, so 270 seconds pass at once.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: string, init?: RequestInit) => neverAnswered(init?.signal))
    );

    const failure = runApifyActor(RUN).catch((thrown: unknown) => thrown);
    await vi.advanceTimersByTimeAsync(270_000);

    expect(await failure).toEqual(new Error("no answer within 270 seconds"));
  });

  test("a run is still waited for just before the wait is over", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let settled = false;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: string, init?: RequestInit) => neverAnswered(init?.signal))
    );

    const failure = runApifyActor(RUN).finally(() => {
      settled = true;
    });
    failure.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(269_000);

    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
  });

  test("a request that fails for another reason passes its own failure on", async () => {
    const original = new TypeError("fetch failed");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(original));

    await expect(runApifyActor(RUN)).rejects.toBe(original);
  });
});
