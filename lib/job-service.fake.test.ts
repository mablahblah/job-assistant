import { describe, expect, test } from "vitest";
import type { JobListEntry } from "./job-list-entry";
import { fakeJobService } from "./job-service.fake";

// The fake stands in for the real service in the save step's tests, so it has
// to reach the same answers the real one does. These checks mirror
// lib/job-service.test.ts: where the two files disagree, the fake is lying and
// every test that trusts it is worthless.

// Greenhouse outranks adzuna, so a contested field these two both fill goes
// greenhouse's way whichever side it arrived on.
const PRIORITY_LIST = ["collector:greenhouse", "collector:adzuna"];

// A fixed date, so nothing in these tests depends on when they run.
const COLLECTED_AT = new Date("2026-01-01T00:00:00.000Z");

function storedJob(id: string, fields: Partial<JobListEntry> = {}): JobListEntry {
  return { id, collected_at: COLLECTED_AT, status: "backlog", ...fields };
}

describe("creating a row", () => {
  test("keeps the id the entry brought", async () => {
    const jobs: JobListEntry[] = [];
    const service = fakeJobService(jobs);

    const result = await service.update(
      { id: "create-keeps-id", collected_at: COLLECTED_AT, raw_title: "Product Designer" },
      PRIORITY_LIST
    );

    expect(result.outcome).toBe("created");
    expect(result.job.id).toBe("create-keeps-id");
    expect(result.job.raw_title).toBe("Product Designer");
  });

  // The real service gets this from the schema's own default, which a fake
  // holding plain objects has to supply itself.
  test("takes backlog where the entry carries no status", async () => {
    const service = fakeJobService([]);

    const result = await service.update(
      { id: "create-default-status", collected_at: COLLECTED_AT },
      PRIORITY_LIST
    );

    expect(result.job.status).toBe("backlog");
  });

  // The caller seeds and reads back through its own array, the way the
  // company fake works, so a step's test can see what save did.
  test("puts the new row in the caller's own array", async () => {
    const jobs: JobListEntry[] = [];
    const service = fakeJobService(jobs);

    await service.update({ id: "create-visible", collected_at: COLLECTED_AT }, PRIORITY_LIST);

    expect(jobs.map((job) => job.id)).toEqual(["create-visible"]);
  });

  test("refuses an entry carrying no id", async () => {
    const service = fakeJobService([]);

    await expect(service.update({ collected_at: COLLECTED_AT }, PRIORITY_LIST)).rejects.toThrow(
      /requires entry\.id/i
    );
  });

  test("refuses to create a row with no collection date", async () => {
    const service = fakeJobService([]);

    await expect(service.update({ id: "create-no-date" }, PRIORITY_LIST)).rejects.toThrow(
      /without collected_at/i
    );
  });
});

describe("updating a row", () => {
  test("changes only the field the entry named", async () => {
    const jobs = [storedJob("update-one-field", { raw_title: "Kept Title", is_parsed: false })];
    const service = fakeJobService(jobs);

    const result = await service.update({ id: "update-one-field", is_parsed: true }, PRIORITY_LIST);

    expect(result.outcome).toBe("updated");
    expect(jobs[0]?.is_parsed).toBe(true);
    expect(jobs[0]?.raw_title).toBe("Kept Title");
  });

  test("gives a contested field to the better-ranked source", async () => {
    const jobs = [storedJob("update-contest", { collector: "adzuna", title: "Adzuna Title" })];
    const service = fakeJobService(jobs);

    await service.update(
      { id: "update-contest", collector: "greenhouse", title: "Greenhouse Title" },
      PRIORITY_LIST
    );

    expect(jobs[0]?.title).toBe("Greenhouse Title");
    expect(jobs[0]?.collector).toBe("greenhouse");
  });

  // rejected is not an active status, so the row is freely updatable, and a
  // freshly collected entry carries no status to reset it with.
  test("leaves a rejected row's status alone where the entry carries none", async () => {
    const jobs = [storedJob("update-rejected", { status: "rejected", raw_title: "Old" })];
    const service = fakeJobService(jobs);

    await service.update(
      { id: "update-rejected", collector: "greenhouse", raw_title: "New" },
      PRIORITY_LIST
    );

    expect(jobs[0]?.status).toBe("rejected");
    expect(jobs[0]?.raw_title).toBe("New");
  });

  // The real service has a create the database refuses to recover from. A
  // fake has no second writer, so an id it already holds is simply an update.
  test("updates rather than creating where it already holds that id", async () => {
    const jobs = [storedJob("update-not-create", { raw_title: "Already Here" })];
    const service = fakeJobService(jobs);

    const result = await service.update(
      { id: "update-not-create", collected_at: COLLECTED_AT, description: "arrived second" },
      PRIORITY_LIST
    );

    expect(result.outcome).toBe("updated");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.description).toBe("arrived second");
  });
});

describe("a row the user has applied to", () => {
  test("takes a new status and nothing else", async () => {
    const jobs = [storedJob("active-status-change", { status: "interview", raw_title: "Old Title" })];
    const service = fakeJobService(jobs);

    const result = await service.update(
      { id: "active-status-change", status: "offer", raw_title: "New Title" },
      PRIORITY_LIST
    );

    expect(result.outcome).toBe("status_updated");
    expect(jobs[0]?.status).toBe("offer");
    expect(jobs[0]?.raw_title).toBe("Old Title");
  });

  test("is left untouched where the entry carries no status", async () => {
    const jobs = [storedJob("active-no-status", { status: "screening", raw_title: "Frozen Title" })];
    const service = fakeJobService(jobs);

    const result = await service.update(
      { id: "active-no-status", raw_title: "Ignored Title" },
      PRIORITY_LIST
    );

    expect(result.outcome).toBe("unchanged");
    expect(jobs[0]?.status).toBe("screening");
    expect(jobs[0]?.raw_title).toBe("Frozen Title");
  });
});

describe("deleting a row", () => {
  test("removes a row in a non-active status", async () => {
    const jobs = [storedJob("delete-plain")];
    const service = fakeJobService(jobs);

    const result = await service.delete("delete-plain");

    expect(result.deleted).toBe(true);
    expect(result.blockedBy).toBeNull();
    expect(jobs).toHaveLength(0);
  });

  test("writes nothing where no row holds that id", async () => {
    const jobs = [storedJob("delete-untouched")];
    const service = fakeJobService(jobs);

    const result = await service.delete("delete-nobody-holds");

    expect(result.deleted).toBe(false);
    expect(result.blockedBy).toBeNull();
    expect(jobs).toHaveLength(1);
  });

  test("refuses a row the user has applied to and hands it back", async () => {
    const jobs = [storedJob("delete-active", { status: "app. sent", raw_title: "Applied Job" })];
    const service = fakeJobService(jobs);

    const result = await service.delete("delete-active");

    expect(result.deleted).toBe(false);
    expect(result.blockedBy?.id).toBe("delete-active");
    expect(result.blockedBy?.raw_title).toBe("Applied Job");
    expect(jobs).toHaveLength(1);
  });
});

// Every other fake in the project takes overrides, so a test can force one
// method to misbehave without hand-building the whole service.
describe("overrides", () => {
  // The override reports a delete against an empty array, which the fake's
  // own delete never does, so the answer can only have come from the override.
  test("a supplied method replaces the fake's own", async () => {
    const service = fakeJobService([], {
      delete: async () => ({ deleted: true, blockedBy: null }),
    });

    expect(await service.delete("nothing-is-held")).toEqual({ deleted: true, blockedBy: null });
  });
});
