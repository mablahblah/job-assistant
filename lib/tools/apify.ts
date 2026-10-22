// Wraps Apify, which runs and bills paid scrapers ("actors"). It knows no actor
// or service by name: the caller holds the actor, its input and its operating
// values, so no site's name lives outside a collector or parser.
import { fetchWithTimeout, NetworkTimeoutError, safeJson } from "../utils/fetch-utils";
import { shortReply } from "../utils/short-reply";

export interface ApifyRun {
  // Already in Apify's address form, "owner~name".
  actor: string;
  input: Record<string, unknown>;
  token: string;
  // What Apify is told to stop the run at.
  timeLimitSeconds: number;
  // What Apify is told to stop charging at.
  chargeCapUsd: number;
  // How long the app itself waits for an answer.
  waitSeconds: number;
}

// Runs one actor and hands back the items it produced. Throws on a refusal,
// a wait that ran out, or an answer that is not a list.
export async function runApifyActor(run: ApifyRun): Promise<unknown[]> {
  const query = new URLSearchParams({
    timeout: String(run.timeLimitSeconds),
    maxTotalChargeUsd: String(run.chargeCapUsd),
  });
  const url = `https://api.apify.com/v2/acts/${run.actor}/run-sync-get-dataset-items?${query}`;

  let res: Response;
  try {
    res = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // The token travels only here, never in the address.
        authorization: `Bearer ${run.token}`,
      },
      body: JSON.stringify(run.input),
      timeoutMs: run.waitSeconds * 1000,
    });
  } catch (err) {
    if (err instanceof NetworkTimeoutError) {
      throw new Error(`no answer within ${run.waitSeconds} seconds`);
    }
    throw err;
  }

  if (!res.ok) {
    // The service's own wording is the only clue to the cause, such as a spent
    // monthly allowance, so it is shown alongside the code.
    throw new Error(`HTTP ${res.status}: ${shortReply(await res.text())}`);
  }

  const items = await safeJson<unknown>(res, "Apify");
  if (!Array.isArray(items)) {
    throw new Error("Apify's answer was not a list of items");
  }
  return items;
}
