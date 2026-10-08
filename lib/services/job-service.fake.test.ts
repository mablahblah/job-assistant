import { describe, expect, test } from "vitest";
import type { JobListEntry } from "../types/job-list-entry";
import type { CompanyRecord } from "./company-service";
import { fakeJobService } from "./job-service.fake";

// The fake stands in for the real service in the save step's tests, so it has
// to reach the same answers the real one does. These checks mirror
// lib/services/job-service.test.ts: where the two files disagree, the fake is lying and
// every test that trusts it is worthless.

// Greenhouse outranks adzuna, so a contested field these two both fill goes
// greenhouse's way whichever side it arrived on.
const PRIORITY_LIST = ["collector:greenhouse", "collector:adzuna"];
// None named, so every query value is dropped from a match key — these tests
// are about saving, not about which values identify a job.
const NO_IDENTIFYING_QUERY_VALUES: readonly string[] = [];

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
      PRIORITY_LIST, NO_IDENTIFYING_QUERY_VALUES
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
      PRIORITY_LIST, NO_IDENTIFYING_QUERY_VALUES
    );

    expect(result.job.status).toBe("backlog");
  });

  // The caller seeds and reads back through its own array, the way the
  // company fake works, so a step's test can see what save did.
  test("puts the new row in the caller's own array", async () => {
    const jobs: JobListEntry[] = [];
    const service = fakeJobService(jobs);

    await service.update({ id: "create-visible", collected_at: COLLECTED_AT }, PRIORITY_LIST, NO_IDENTIFYING_QUERY_VALUES);

    expect(jobs.map((job) => job.id)).toEqual(["create-visible"]);
  });

  test("refuses an entry carrying no id", async () => {
    const service = fakeJobService([]);

    await expect(service.update({ collected_at: COLLECTED_AT }, PRIORITY_LIST, NO_IDENTIFYING_QUERY_VALUES)).rejects.toThrow(
      /requires entry\.id/i
    );
  });

  test("refuses to create a row with no collection date", async () => {
    const service = fakeJobService([]);

    await expect(service.update({ id: "create-no-date" }, PRIORITY_LIST, NO_IDENTIFYING_QUERY_VALUES)).rejects.toThrow(
      /without collected_at/i
    );
  });
});

describe("updating a row", () => {
  test("changes only the field the entry named", async () => {
    const jobs = [storedJob("update-one-field", { raw_title: "Kept Title", is_parsed: false })];
    const service = fakeJobService(jobs);

    const result = await service.update({ id: "update-one-field", is_parsed: true }, PRIORITY_LIST, NO_IDENTIFYING_QUERY_VALUES);

    expect(result.outcome).toBe("updated");
    expect(jobs[0]?.is_parsed).toBe(true);
    expect(jobs[0]?.raw_title).toBe("Kept Title");
  });

  test("gives a contested field to the better-ranked source", async () => {
    const jobs = [storedJob("update-contest", { collector: "adzuna", title: "Adzuna Title" })];
    const service = fakeJobService(jobs);

    await service.update(
      { id: "update-contest", collector: "greenhouse", title: "Greenhouse Title" },
      PRIORITY_LIST, NO_IDENTIFYING_QUERY_VALUES
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
      PRIORITY_LIST, NO_IDENTIFYING_QUERY_VALUES
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
      PRIORITY_LIST, NO_IDENTIFYING_QUERY_VALUES
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
      PRIORITY_LIST, NO_IDENTIFYING_QUERY_VALUES
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
      PRIORITY_LIST, NO_IDENTIFYING_QUERY_VALUES
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

// The fake stands in for the real service wherever a test does not want a
// database, so anything the real service derives at write time the fake has to
// derive the same way. Where the two disagree, every test trusting the fake is
// worthless.
describe("writing the link match keys", () => {
  // AC 21.
  test("a created job carries both keys built from its links", async () => {
    const jobs: JobListEntry[] = [];
    const service = fakeJobService(jobs);

    await service.update(
      {
        id: "fake-keys-create",
        collected_at: COLLECTED_AT,
        original_url: "https://www.adzuna.com/land/ad/5872600391?se=abc",
        resolved_url: "https://boards.greenhouse.io/acme/jobs/456?gh_src=x",
      },
      PRIORITY_LIST,
      NO_IDENTIFYING_QUERY_VALUES
    );

    const held = jobs[0];
    expect(held?.original_url_match_key).toBe("https://www.adzuna.com/land/ad/5872600391");
    expect(held?.resolved_url_match_key).toBe("https://boards.greenhouse.io/acme/jobs/456");
  });

  // AC 21. Resolution fills resolved_url long after the job first appeared.
  test("an update writing a link for the first time writes its key", async () => {
    const jobs: JobListEntry[] = [storedJob("fake-keys-update", { collector: "greenhouse" })];
    const service = fakeJobService(jobs);

    await service.update(
      { id: "fake-keys-update", resolved_url: "https://jobs.lever.co/acme/9f2c1b?lever-source=x" },
      PRIORITY_LIST, NO_IDENTIFYING_QUERY_VALUES
    );

    expect(jobs[0]?.resolved_url_match_key).toBe("https://jobs.lever.co/acme/9f2c1b");
  });

  // AC 21. A write that never mentions a link must not wipe the key held for
  // it, which is the same rule toColumnData follows in the real service.
  test("a write that mentions no link leaves the held keys standing", async () => {
    const jobs: JobListEntry[] = [
      storedJob("fake-keys-untouched", {
        original_url: "https://example.com/jobs/1",
        original_url_match_key: "https://example.com/jobs/1",
      }),
    ];
    const service = fakeJobService(jobs);

    await service.update({ id: "fake-keys-untouched", is_parsed: true }, PRIORITY_LIST, NO_IDENTIFYING_QUERY_VALUES);

    expect(jobs[0]?.original_url_match_key).toBe("https://example.com/jobs/1");
  });
});

describe("the timestamps the database would set", () => {
  // AC 22. created_at is what tells a job holding a row from one never saved,
  // so a fake that leaves it empty makes every held job read as unsaved.
  test("a created job carries a created_at and a modified_at", async () => {
    const jobs: JobListEntry[] = [];
    const service = fakeJobService(jobs);

    await service.update({ id: "fake-writes", collected_at: COLLECTED_AT }, PRIORITY_LIST, NO_IDENTIFYING_QUERY_VALUES);

    expect(jobs[0]?.created_at).toBeInstanceOf(Date);
    expect(jobs[0]?.modified_at).toBeInstanceOf(Date);
  });

  // AC 23. modified_at is set back to a known past date first, because two
  // writes can land inside the same millisecond.
  test("an update moves modified_at forward and leaves created_at alone", async () => {
    const jobs: JobListEntry[] = [];
    const service = fakeJobService(jobs);
    await service.update({ id: "fake-moves", collected_at: COLLECTED_AT }, PRIORITY_LIST, NO_IDENTIFYING_QUERY_VALUES);

    const born = jobs[0]?.created_at as Date;
    const longAgo = new Date("2020-01-01T00:00:00.000Z");
    (jobs[0] as JobListEntry).modified_at = longAgo;

    await service.update({ id: "fake-moves", raw_title: "Product Designer" }, PRIORITY_LIST, NO_IDENTIFYING_QUERY_VALUES);

    expect(jobs[0]?.created_at?.getTime()).toBe(born.getTime());
    expect(jobs[0]?.modified_at?.getTime()).toBeGreaterThan(longAgo.getTime());
  });

  // AC 23. An entry carrying its own created_at must never overwrite the one
  // the record was born with, the way toColumnData strips it in the real
  // service.
  test("an entry carrying a created_at never overwrites the held one", async () => {
    const jobs: JobListEntry[] = [];
    const service = fakeJobService(jobs);
    await service.update({ id: "fake-birthday", collected_at: COLLECTED_AT }, PRIORITY_LIST, NO_IDENTIFYING_QUERY_VALUES);
    const born = jobs[0]?.created_at as Date;

    await service.update(
      { id: "fake-birthday", created_at: new Date("2020-01-01T00:00:00.000Z") },
      PRIORITY_LIST, NO_IDENTIFYING_QUERY_VALUES
    );

    expect(jobs[0]?.created_at?.getTime()).toBe(born.getTime());
  });

  // AC 23. A status-only write to an active row is still a write.
  test("a status-only write to an active row moves modified_at", async () => {
    const jobs: JobListEntry[] = [storedJob("fake-active", { status: "app. sent" })];
    const longAgo = new Date("2020-01-01T00:00:00.000Z");
    (jobs[0] as JobListEntry).modified_at = longAgo;
    const service = fakeJobService(jobs);

    await service.update({ id: "fake-active", status: "interview" }, PRIORITY_LIST, NO_IDENTIFYING_QUERY_VALUES);

    expect(jobs[0]?.status).toBe("interview");
    expect(jobs[0]?.modified_at?.getTime()).toBeGreaterThan(longAgo.getTime());
  });

  // AC 23. Nothing was written, so nothing moves.
  test("an unchanged result leaves modified_at where it was", async () => {
    const jobs: JobListEntry[] = [storedJob("fake-unchanged", { status: "app. sent" })];
    const longAgo = new Date("2020-01-01T00:00:00.000Z");
    (jobs[0] as JobListEntry).modified_at = longAgo;
    const service = fakeJobService(jobs);

    const result = await service.update({ id: "fake-unchanged" }, PRIORITY_LIST, NO_IDENTIFYING_QUERY_VALUES);

    expect(result.outcome).toBe("unchanged");
    expect(jobs[0]?.modified_at?.getTime()).toBe(longAgo.getTime());
  });
});

describe("a key follows the link that won the merge", () => {
  // AC 21. greenhouse outranks adzuna, so the held link stands and its key
  // has to stand with it. Writing from the arriving link instead would leave
  // the winning link sitting beside the losing link's key.
  test("a losing link does not write its key over the winning link's", async () => {
    const jobs: JobListEntry[] = [
      storedJob("fake-keys-contest", {
        collector: "greenhouse",
        original_url: "https://boards.greenhouse.io/acme/jobs/999",
        original_url_match_key: "https://boards.greenhouse.io/acme/jobs/999",
      }),
    ];
    const service = fakeJobService(jobs);

    await service.update(
      {
        id: "fake-keys-contest",
        collector: "adzuna",
        original_url: "https://www.adzuna.com/land/ad/111?se=x",
      },
      PRIORITY_LIST, NO_IDENTIFYING_QUERY_VALUES
    );

    expect(jobs[0]?.original_url).toBe("https://boards.greenhouse.io/acme/jobs/999");
    expect(jobs[0]?.original_url_match_key).toBe("https://boards.greenhouse.io/acme/jobs/999");
  });
});

// The fake is the stand-in dedupe's step tests look up through, so its three
// lookups have to answer what the real ones answer. Where they disagree the
// fake is lying and every step test that trusts it is worthless.
describe("the dedupe lookups", () => {
  test("finds every held job holding an original-url match key", async () => {
    const service = fakeJobService([
      storedJob("orig-a", { original_url_match_key: "https://example.com/jobs/7" }),
      storedJob("orig-b", { original_url_match_key: "https://example.com/jobs/7" }),
      storedJob("orig-c", { original_url_match_key: "https://example.com/jobs/8" }),
    ]);

    const found = await service.findByOriginalUrlMatchKey("https://example.com/jobs/7");

    expect(found.map((job) => job.id)).toEqual(["orig-a", "orig-b"]);
  });

  test("finds nothing where no held job holds the original-url key", async () => {
    const service = fakeJobService([storedJob("orig-d")]);

    const found = await service.findByOriginalUrlMatchKey("https://example.com/nobody-here");

    expect(found).toEqual([]);
  });

  test("finds every held job holding a resolved-url match key", async () => {
    const service = fakeJobService([
      storedJob("res-a", { resolved_url_match_key: "https://boards.example.com/9" }),
      storedJob("res-b", { resolved_url_match_key: "https://boards.example.com/10" }),
    ]);

    const found = await service.findByResolvedUrlMatchKey("https://boards.example.com/9");

    expect(found.map((job) => job.id)).toEqual(["res-a"]);
  });

  test("finds every held job sharing a company and a title", async () => {
    const service = fakeJobService([
      storedJob("ct-a", { company_id: "company-77", title: "Senior Product Designer" }),
      storedJob("ct-b", { company_id: "company-77", title: "Senior Product Designer" }),
      storedJob("ct-c", { company_id: "company-77", title: "Design Engineer" }),
      storedJob("ct-d", { company_id: "company-78", title: "Senior Product Designer" }),
    ]);

    const found = await service.findByCompanyAndTitle("company-77", "Senior Product Designer");

    expect(found.map((job) => job.id)).toEqual(["ct-a", "ct-b"]);
  });

  // A job carrying no company or no title matches nothing, the way an
  // absent column in the real table matches no equality test.
  test("ignores a held job carrying neither a company nor a title", async () => {
    const service = fakeJobService([storedJob("ct-e")]);

    const found = await service.findByCompanyAndTitle("company-79", "Product Designer");

    expect(found).toEqual([]);
  });
});

// AC 1 to 4, against the fake. The real read runs against a table where
// status and the three gates always hold a value; the fake holds plain
// objects where a field can simply be missing, so each test below says what
// a missing field means.
describe("the resolution job list", () => {
  test("holds only backlog jobs that are not yet resolved", async () => {
    const service = fakeJobService([
      storedJob("list-waiting"),
      storedJob("list-resolved", { is_resolved: true }),
      storedJob("list-markUnresolvable", { status: "unresolvable" }),
    ]);

    const found = await service.findUnresolved();

    expect(found.map((job) => job.id)).toEqual(["list-waiting"]);
  });

  // AC 2. Nothing narrows the list to one run. A job collected weeks ago and
  // never resolved is still waiting for resolution.
  test("holds a job collected during an earlier run", async () => {
    const service = fakeJobService([
      storedJob("list-earlier", { collected_at: new Date("2025-06-01T00:00:00.000Z") }),
    ]);

    const found = await service.findUnresolved();

    expect(found.map((job) => job.id)).toEqual(["list-earlier"]);
  });

  // The real columns carry database defaults, so a held job saying nothing
  // about its status or its resolution reads the way a real row would.
  test("reads a missing status as backlog and a missing gate as false", async () => {
    const service = fakeJobService([{ id: "list-bare", collected_at: COLLECTED_AT }]);

    const found = await service.findUnresolved();

    expect(found.map((job) => job.id)).toEqual(["list-bare"]);
  });

  // AC 3. The five gate fields are left behind, so an entry carried on to
  // dedupe and save holds no stale copy of a flag another phase owns.
  test("leaves the five gate fields behind", async () => {
    const service = fakeJobService([
      storedJob("list-absent", {
        is_parsed: false,
        is_classified: false,
        is_resolved: false,
        is_judged: false,
      }),
    ]);

    const [entry] = await service.findUnresolved();

    expect(entry).not.toHaveProperty("status");
    expect(entry).not.toHaveProperty("is_resolved");
    expect(entry).not.toHaveProperty("is_parsed");
    expect(entry).not.toHaveProperty("is_classified");
    expect(entry).not.toHaveProperty("is_judged");
  });

  // AC 4. Resolution needs the id to write back and the collector to know
  // whether a blacklisted job may be dropped, and dedupe reads created_at as
  // the sign that an entry already holds a database row.
  test("carries the id, the collector and the created_at", async () => {
    const created = new Date("2026-02-02T00:00:00.000Z");
    const service = fakeJobService([
      storedJob("list-present", { collector: "adzuna", created_at: created }),
    ]);

    const [entry] = await service.findUnresolved();

    expect(entry?.id).toBe("list-present");
    expect(entry?.collector).toBe("adzuna");
    expect(entry?.created_at).toEqual(created);
  });

  // The fake's other lookups read the caller's array directly. This one hands
  // back copies, so a job's resolution writing to an entry cannot reach into the held job
  // behind the service's back.
  test("hands back a copy rather than the held job", async () => {
    const jobs = [storedJob("list-copy")];
    const service = fakeJobService(jobs);

    const [entry] = await service.findUnresolved();

    expect(entry).not.toBe(jobs[0]);
  });
});

describe("the fake's parsing job list", () => {
  test("holds only backlog jobs that are resolved and not yet parsed", async () => {
    const service = fakeJobService([
      storedJob("waiting", { is_resolved: true }),
      storedJob("unresolved"),
      storedJob("parsed", { is_resolved: true, is_parsed: true }),
      storedJob("unparseable", { is_resolved: true, status: "unparseable" }),
    ]);

    const found = await service.findUnparsed();

    expect(found.map((job) => job.id)).toEqual(["waiting"]);
  });

  test("leaves the five gate fields behind, as the real read does", async () => {
    const service = fakeJobService([storedJob("waiting", { is_resolved: true, is_judged: false })]);

    const [entry] = await service.findUnparsed();

    expect(entry).not.toHaveProperty("status");
    expect(entry).not.toHaveProperty("is_resolved");
    expect(entry).not.toHaveProperty("is_parsed");
    expect(entry).not.toHaveProperty("is_classified");
    expect(entry).not.toHaveProperty("is_judged");
  });
});

// Thirty days after COLLECTED_AT, so a job seeded with no posting date reads
// as thirty days old.
const RUN_DATE = new Date("2026-01-31T00:00:00.000Z");

describe("the fake's backlog cleanup job list", () => {
  test("holds every backlog job, whatever else it has been through", async () => {
    const service = fakeJobService([
      storedJob("plain"),
      storedJob("resolved", { is_resolved: true }),
      storedJob("judged", { is_resolved: true, is_parsed: true, is_classified: true }),
      storedJob("expired", { status: "expired" }),
      storedJob("too-far", { status: "too far" }),
    ]);

    const found = await service.findBacklog();

    expect(found.map((job) => job.id)).toEqual(["plain", "resolved", "judged"]);
  });

  test("leaves the five gate fields behind, as the real read does", async () => {
    const service = fakeJobService([storedJob("plain", { is_judged: false })]);
    const [entry] = await service.findBacklog();
    expect(entry).not.toHaveProperty("status");
    expect(entry).not.toHaveProperty("is_classified");
    expect(entry).not.toHaveProperty("is_judged");
  });
});

describe("the fake's backlog jobs read back by id", () => {
  test("holds only the named backlog jobs not yet followed, for link following", async () => {
    const service = fakeJobService([
      storedJob("new"),
      storedJob("done", { is_resolved: true }),
      storedJob("ruled-out", { status: "won't apply" }),
      storedJob("unnamed"),
    ]);

    const found = await service.findBacklogByIds(["new", "done", "ruled-out"], "resolution");

    expect(found.map((job) => job.id)).toEqual(["new"]);
  });

  test("holds only the named backlog jobs not yet read, followed or not, for page reading", async () => {
    const service = fakeJobService([
      storedJob("unfollowed"),
      storedJob("followed", { is_resolved: true }),
      storedJob("done", { is_resolved: true, is_parsed: true }),
      storedJob("ruled-out", { status: "rejected", is_resolved: true }),
    ]);

    const found = await service.findBacklogByIds(
      ["unfollowed", "followed", "done", "ruled-out"],
      "parsing"
    );

    expect(found.map((job) => job.id)).toEqual(["unfollowed", "followed"]);
  });

  test("holds only the named backlog jobs not yet location-checked, for the location check", async () => {
    const service = fakeJobService([
      storedJob("new", { is_resolved: true, is_parsed: true }),
      storedJob("unfollowed", { is_parsed: true }),
      storedJob("done", { is_resolved: true, is_parsed: true, is_classified: true }),
      storedJob("too-far", { status: "too far", is_resolved: true, is_parsed: true }),
    ]);

    const found = await service.findBacklogByIds(
      ["new", "unfollowed", "done", "too-far"],
      "classification"
    );

    expect(found.map((job) => job.id)).toEqual(["new", "unfollowed"]);
  });

  test("leaves the five gate fields behind, as the real read does", async () => {
    const service = fakeJobService([storedJob("plain", { is_resolved: true, is_judged: false })]);
    const [entry] = await service.findBacklogByIds(["plain"], "parsing");
    expect(entry?.id).toBe("plain");
    expect(entry).not.toHaveProperty("status");
    expect(entry).not.toHaveProperty("is_resolved");
    expect(entry).not.toHaveProperty("is_parsed");
    expect(entry).not.toHaveProperty("is_classified");
    expect(entry).not.toHaveProperty("is_judged");
  });

  test("names no job and hands back nothing", async () => {
    const service = fakeJobService([storedJob("plain")]);
    expect(await service.findBacklogByIds([], "resolution")).toEqual([]);
  });
});

describe("the fake's promotion job list", () => {
  test("holds only expired jobs whose age is back inside the threshold", async () => {
    const service = fakeJobService([
      storedJob("relisted", {
        status: "expired",
        posting_date: new Date("2026-01-30T00:00:00.000Z"),
      }),
      storedJob("still-old", {
        status: "expired",
        posting_date: new Date("2025-06-01T00:00:00.000Z"),
      }),
      storedJob("in-backlog", { posting_date: new Date("2026-01-30T00:00:00.000Z") }),
    ]);

    const found = await service.findExpiredWithin(8, RUN_DATE);

    expect(found.map((job) => job.id)).toEqual(["relisted"]);
  });

  test("measures from the updated date when the source published one", async () => {
    const service = fakeJobService([
      storedJob("relisted", {
        status: "expired",
        posting_date: new Date("2025-06-01T00:00:00.000Z"),
        posting_updated_date: new Date("2026-01-30T00:00:00.000Z"),
      }),
    ]);

    const found = await service.findExpiredWithin(8, RUN_DATE);

    expect(found.map((job) => job.id)).toEqual(["relisted"]);
  });

  test("leaves the five gate fields behind, as the real read does", async () => {
    const service = fakeJobService([
      storedJob("relisted", {
        status: "expired",
        posting_date: new Date("2026-01-30T00:00:00.000Z"),
        is_judged: false,
      }),
    ]);
    const [entry] = await service.findExpiredWithin(8, RUN_DATE);
    expect(entry).not.toHaveProperty("status");
    expect(entry).not.toHaveProperty("is_classified");
    expect(entry).not.toHaveProperty("is_judged");
  });
});

describe("the fake's classification job list", () => {
  test("holds only backlog jobs that are resolved, parsed and not yet judged", async () => {
    const service = fakeJobService([
      storedJob("ready", { is_resolved: true, is_parsed: true }),
      storedJob("unresolved", { is_parsed: true }),
      storedJob("unparsed", { is_resolved: true }),
      storedJob("done", { is_resolved: true, is_parsed: true, is_classified: true }),
      storedJob("expired", { is_resolved: true, is_parsed: true, status: "expired" }),
    ]);

    const found = await service.findUnclassified();

    expect(found.map((job) => job.id)).toEqual(["ready"]);
  });

  test("leaves the five gate fields behind, as the real read does", async () => {
    const service = fakeJobService([
      storedJob("ready", { is_resolved: true, is_parsed: true, is_judged: false }),
    ]);
    const [entry] = await service.findUnclassified();
    expect(entry).not.toHaveProperty("status");
    expect(entry).not.toHaveProperty("is_classified");
    expect(entry).not.toHaveProperty("is_judged");
  });
});

// Criteria 7 and 8, on the stand-in the handlers' own tests use.
describe("the fake reading one job by its id", () => {
  test("gives back the held job carrying that id", async () => {
    const service = fakeJobService([
      { id: "held-a", title: "Senior Product Designer" },
      { id: "held-b", title: "Design Engineer" },
    ]);

    expect((await service.findById("held-a"))?.title).toBe("Senior Product Designer");
  });

  test("gives back nothing where no held job carries that id", async () => {
    const service = fakeJobService([{ id: "held-a" }]);

    expect(await service.findById("nobody")).toBeNull();
  });

  test("holds no new job after a read that found nothing", async () => {
    const jobs = [{ id: "held-a" }];
    const service = fakeJobService(jobs);

    await service.findById("nobody");

    expect(jobs).toHaveLength(1);
  });
});

// AC 86, 87, 88, 91, 101. The fake holds jobs and no employers, so it matches
// on the employer name the job itself carries. A test that needs the stored
// employer's name rather than the collected one belongs against the real
// service, not here.
describe("searching by part of an employer's name", () => {
  test("gives back every job whose employer name holds that part", async () => {
    const service = fakeJobService([
      storedJob("fake-search-a", { raw_company_name: "Indeed", title: "Product Designer" }),
      storedJob("fake-search-b", { raw_company_name: "Figma", title: "Product Designer" }),
    ]);

    const found = await service.findByCompanyNameMatch({ companyNamePart: "ndee" });

    expect(found.map((job) => job.id)).toEqual(["fake-search-a"]);
  });

  test("ignores letter casing in the part it is handed", async () => {
    const service = fakeJobService([
      storedJob("fake-search-case", { raw_company_name: "Figma", title: "Product Designer" }),
    ]);

    const found = await service.findByCompanyNameMatch({ companyNamePart: "FIGMA" });

    expect(found.map((job) => job.id)).toEqual(["fake-search-case"]);
  });

  test("keeps only the jobs holding one of the statuses it was handed", async () => {
    const service = fakeJobService([
      storedJob("fake-search-backlog", { raw_company_name: "Notion", status: "backlog" }),
      storedJob("fake-search-sent", { raw_company_name: "Notion", status: "app. sent" }),
    ]);

    const found = await service.findByCompanyNameMatch({
      companyNamePart: "Notion",
      statuses: ["backlog"],
    });

    expect(found.map((job) => job.id)).toEqual(["fake-search-backlog"]);
  });

  test("puts the most recently published job first", async () => {
    const service = fakeJobService([
      storedJob("fake-search-older", {
        raw_company_name: "Linear",
        posting_date: new Date("2026-01-10T00:00:00.000Z"),
      }),
      storedJob("fake-search-newer", {
        raw_company_name: "Linear",
        posting_date: new Date("2026-04-10T00:00:00.000Z"),
      }),
    ]);

    const found = await service.findByCompanyNameMatch({ companyNamePart: "Linear" });

    expect(found.map((job) => job.id)).toEqual(["fake-search-newer", "fake-search-older"]);
  });

  test("gives back nothing where no employer name holds that part", async () => {
    const service = fakeJobService([storedJob("fake-search-x", { raw_company_name: "Indeed" })]);

    expect(await service.findByCompanyNameMatch({ companyNamePart: "nobody" })).toEqual([]);
  });
});

// Mirrors the real service's read of the jobs holding a link's match key in
// either saved-link column.
describe("searching by a link's match key", () => {
  test("gives back the job whose collected link holds that key", async () => {
    const service = fakeJobService([
      storedJob("fake-link-original", { original_url_match_key: "https://a.example.com/1" }),
      storedJob("fake-link-other", { original_url_match_key: "https://a.example.com/9" }),
    ]);

    const found = await service.findByUrlMatchKey({ matchKey: "https://a.example.com/1" });

    expect(found.map((job) => job.id)).toEqual(["fake-link-original"]);
  });

  test("gives back the job whose source posting link holds that key", async () => {
    const service = fakeJobService([
      storedJob("fake-link-resolved", { resolved_url_match_key: "https://b.example.com/2" }),
    ]);

    const found = await service.findByUrlMatchKey({ matchKey: "https://b.example.com/2" });

    expect(found.map((job) => job.id)).toEqual(["fake-link-resolved"]);
  });

  test("gives back a job once when both its links hold that key", async () => {
    const key = "https://c.example.com/3";
    const service = fakeJobService([
      storedJob("fake-link-both", { original_url_match_key: key, resolved_url_match_key: key }),
    ]);

    const found = await service.findByUrlMatchKey({ matchKey: key });

    expect(found.map((job) => job.id)).toEqual(["fake-link-both"]);
  });

  test("gives back every job holding that key, the most recently published first", async () => {
    const key = "https://d.example.com/4";
    const service = fakeJobService([
      storedJob("fake-link-older", {
        resolved_url_match_key: key,
        posting_date: new Date("2026-01-01T00:00:00.000Z"),
      }),
      storedJob("fake-link-newer", {
        original_url_match_key: key,
        posting_date: new Date("2026-03-01T00:00:00.000Z"),
      }),
    ]);

    const found = await service.findByUrlMatchKey({ matchKey: key });

    expect(found.map((job) => job.id)).toEqual(["fake-link-newer", "fake-link-older"]);
  });

  test("keeps only the jobs holding one of the statuses it was handed", async () => {
    const key = "https://e.example.com/5";
    const service = fakeJobService([
      storedJob("fake-link-backlog", { original_url_match_key: key, status: "backlog" }),
      storedJob("fake-link-sent", { resolved_url_match_key: key, status: "app. sent" }),
    ]);

    const found = await service.findByUrlMatchKey({ matchKey: key, statuses: ["app. sent"] });

    expect(found.map((job) => job.id)).toEqual(["fake-link-sent"]);
  });

  test("names each job exactly as the employer search does", async () => {
    const service = fakeJobService([
      storedJob("fake-link-named", {
        raw_company_name: "Vercel",
        title: "Senior Product Designer",
        status: "app. sent",
        posting_date: new Date("2026-05-01T00:00:00.000Z"),
        original_url: "https://www.adzuna.com/land/ad/6?se=b",
        original_url_match_key: "https://www.adzuna.com/land/ad/6",
        resolved_url: "https://vercel.com/careers/6",
        resolved_url_match_key: "https://vercel.com/careers/6",
        location_match_place: "Austin, TX",
      }),
    ]);

    const byLink = await service.findByUrlMatchKey({ matchKey: "https://vercel.com/careers/6" });
    const byEmployer = await service.findByCompanyNameMatch({ companyNamePart: "Vercel" });

    expect(byLink).toEqual(byEmployer);
  });

  test("gives back nothing where no job holds that key", async () => {
    const service = fakeJobService([
      storedJob("fake-link-x", { original_url_match_key: "https://f.example.com/7" }),
    ]);

    expect(await service.findByUrlMatchKey({ matchKey: "https://nowhere.example.com/0" })).toEqual(
      []
    );
  });
});

// The dashboard's two reads. The fake grows an employer table for them,
// because a job's employer carries four of the five ratings behind its total
// and the page works that total out as it is built.
describe("the dashboard's reads", () => {
  function employer(id: string, name: string): CompanyRecord {
    return {
      id,
      name,
      match_key: name.toLowerCase(),
      employee_satisfaction: 4,
      customer_satisfaction: 4,
      work_life_balance: 4,
      political_alignment: 4,
      employee_satisfaction_rationale: null,
      customer_satisfaction_rationale: null,
      work_life_balance_rationale: null,
      political_alignment_rationale: null,
      scored_at: null,
      scores_guessed: [],
      address: null,
      phone: null,
      website: null,
      enriched_at: null,
      enrichment_status: null,
      enrichment_uncertain: false,
      enrichment_flags: [],
    };
  }

  const held: JobListEntry[] = [
    { id: "fake-backlog", status: "backlog", company_id: "fake-co" },
    { id: "fake-sent", status: "app. sent" },
    { id: "fake-expired", status: "expired" },
  ];

  function service() {
    return fakeJobService([...held], {}, [employer("fake-co", "Acme")]);
  }

  test("gives back only the jobs holding one of the statuses asked for", async () => {
    const found = await service().findByStatuses(["backlog"]);

    expect(found.map((row) => row.job.id)).toEqual(["fake-backlog"]);
  });

  test("covers every status it was handed", async () => {
    const found = await service().findByStatuses(["app. sent", "expired"]);

    expect(found.map((row) => row.job.id)).toEqual(["fake-sent", "fake-expired"]);
  });

  test("hands back the employer beside the job", async () => {
    const [row] = await service().findByStatuses(["backlog"]);

    expect(row.company?.name).toBe("Acme");
  });

  test("hands back nothing in the employer's place where the job has none", async () => {
    const [row] = await service().findByStatuses(["app. sent"]);

    expect(row.company).toBeNull();
  });

  test("gives back nothing where no status was asked for", async () => {
    expect(await service().findByStatuses([])).toEqual([]);
  });

  test("gives back the jobs holding the ids asked for, each with its employer", async () => {
    const found = await service().findByIds(["fake-backlog", "fake-sent"]);
    const byId = new Map(found.map((row) => [row.job.id, row]));

    expect(byId.get("fake-backlog")?.company?.name).toBe("Acme");
    expect(byId.get("fake-sent")?.company).toBeNull();
  });

  test("passes over an id no job holds", async () => {
    const found = await service().findByIds(["fake-backlog", "fake-deleted"]);

    expect(found.map((row) => row.job.id)).toEqual(["fake-backlog"]);
  });

  test("gives back nothing where no id was asked for", async () => {
    expect(await service().findByIds([])).toEqual([]);
  });
});

// Mirrors the same check on the real service: a stored key keeps the query
// values named as identifying, which UltiPro needs to tell openings apart.
describe("a held key keeps the query values named as identifying", () => {
  const BOARD = "https://recruiting.ultipro.com/acm1000acme/jobboard/5b3c/opportunitydetail";

  test("a created job's keys keep the named value and drop the rest", async () => {
    const jobs: JobListEntry[] = [];
    const service = fakeJobService(jobs);
    const link = `${BOARD}?opportunityid=A1&utm_source=adzuna`;

    await service.update(
      { id: "fake-identifying-create", collected_at: COLLECTED_AT, original_url: link, resolved_url: link },
      PRIORITY_LIST,
      ["opportunityid"]
    );

    expect(jobs[0]?.original_url_match_key).toBe(`${BOARD}?opportunityid=A1`);
    expect(jobs[0]?.resolved_url_match_key).toBe(`${BOARD}?opportunityid=A1`);
  });

  test("an update writing a link keeps the named value in its key", async () => {
    const jobs: JobListEntry[] = [storedJob("fake-identifying-update", { collector: "greenhouse" })];
    const service = fakeJobService(jobs);

    await service.update(
      { id: "fake-identifying-update", resolved_url: `${BOARD}?opportunityid=B2&utm_source=x` },
      PRIORITY_LIST,
      ["opportunityid"]
    );

    expect(jobs[0]?.resolved_url_match_key).toBe(`${BOARD}?opportunityid=B2`);
  });
});
