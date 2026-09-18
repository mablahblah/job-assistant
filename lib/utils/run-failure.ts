// Shared by every runner's step wrapper. Three runners each kept their own
// copy of this, and two of the three overwrote the first failure with the
// last one — a bug, because cleanup runs after the thing it cleans up after,
// so a browser that will not shut throws second and buries the reason the run
// actually stopped. One tracker, keeping only the first failure it sees,
// stops that drift.
import { messageFromThrown } from "./thrown-message";

export interface RunFailure {
  // Where the run stopped. A handler's step name, or the name of one of the
  // reads and lookups the run makes between handlers.
  at: string;
  // Always a string, because a thrown value is not guaranteed to be an Error
  // and a report a caller has to unwrap is no report at all.
  reason: string;
}

export function createFailureTracker() {
  // Closed over rather than returned directly, so each tracker keeps its own
  // slot and two trackers can never share a failure.
  let failure: RunFailure | null = null;

  async function at<T>(spot: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (thrown) {
      // The first failure is the one kept. A later step throwing during
      // cleanup is a consequence, not the cause, so it must not replace what
      // is already recorded here.
      failure ??= { at: spot, reason: messageFromThrown(thrown) };
      throw thrown;
    }
  }

  return {
    at,
    failure: () => failure,
  };
}
