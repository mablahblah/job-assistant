// Three runners each kept their own copy of this, and the copies had already
// drifted: one kept the first failure, two overwrote it. Overwriting is the
// bug — cleanup runs after the thing it cleans up after, so a browser that
// will not shut throws second and buries the reason the run actually stopped.
// One shared version is what stops the three drifting again.
import { describe, expect, test } from "vitest";
import { createFailureTracker } from "./run-failure";

describe("tracking where a run stopped", () => {
  test("a run where nothing throws has no failure", async () => {
    const tracker = createFailureTracker();

    await tracker.at("collection", async () => "fine");

    expect(tracker.failure()).toBeNull();
  });

  test("a step that works hands its answer straight back", async () => {
    const tracker = createFailureTracker();

    expect(await tracker.at("collection", async () => 42)).toBe(42);
  });

  test("a step that throws is named along with the reason", async () => {
    const tracker = createFailureTracker();

    await expect(
      tracker.at("collection", async () => {
        throw new Error("the database went away");
      })
    ).rejects.toThrow("the database went away");

    expect(tracker.failure()).toEqual({
      at: "collection",
      reason: "the database went away",
    });
  });

  // The throw has to carry on past here, or the runner above cannot stop.
  test("the throw still leaves rather than being swallowed", async () => {
    const tracker = createFailureTracker();

    await expect(
      tracker.at("collection", async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
  });

  // The whole point. Cleanup throws second and must not bury the first.
  test("a later failure does not replace the one that stopped the run", async () => {
    const tracker = createFailureTracker();

    await tracker
      .at("resolution", async () => {
        throw new Error("the step failed");
      })
      .catch(() => {});
    await tracker
      .at("browser_close", async () => {
        throw new Error("the browser would not shut");
      })
      .catch(() => {});

    expect(tracker.failure()?.at).toBe("resolution");
    expect(tracker.failure()?.reason).toBe("the step failed");
  });

  // A thrown value is not guaranteed to be an Error, and a report a caller
  // has to unwrap is no report at all.
  test("something thrown that is not an error still reads as a reason", async () => {
    const tracker = createFailureTracker();

    await tracker
      .at("collection", async () => {
        throw "just a string";
      })
      .catch(() => {});

    expect(typeof tracker.failure()?.reason).toBe("string");
    expect(tracker.failure()?.reason).toContain("just a string");
  });

  // Two runners run in one process, and one run's failure must not show up
  // in the other's report.
  test("two trackers do not share a failure", async () => {
    const one = createFailureTracker();
    const two = createFailureTracker();

    await one
      .at("collection", async () => {
        throw new Error("only mine");
      })
      .catch(() => {});

    expect(two.failure()).toBeNull();
  });
});
