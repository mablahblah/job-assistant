import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";
import { describe, expect, test } from "vitest";
import type { JobRow } from "../../lib/types/job-row";
import { pageView } from "../../lib/views/page";

// The script runs against the page the server really builds, read without a
// browser, so a change to either side that breaks the other shows up here.
const SCRIPT = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "dashboard.js"), "utf8");

const NOW = new Date("2026-04-20T12:00:00Z");

function backlogJob(id: string, judged: boolean): JobRow {
  return {
    job: {
      id,
      title: `Role ${id}`,
      status: "backlog",
      original_url: `https://boards.example.com/${id}`,
      posting_date: new Date("2026-04-18T12:00:00Z"),
      modified_at: new Date("2026-04-18T12:00:00Z"),
      alignment_score: 4,
      is_resolved: true,
      is_parsed: true,
      is_classified: judged,
      is_judged: judged,
    },
    company: null,
  };
}

// The project type-checks without the browser's own types, so the few parts
// of the page these tests touch are described here.
interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface PageElement {
  classList: { contains(name: string): boolean };
  textContent: string | null;
  click(): void;
}

interface SwitchElement {
  checked: boolean;
  dispatchEvent(event: unknown): boolean;
}

// Stands in for the browser's local storage, which outlives a reload. Handing
// the same one to a second load is what a reload in the same browser looks like.
function fakeStorage(): KeyValueStore {
  const held = new Map<string, string>();
  return {
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => void held.set(key, value),
  };
}

function load(backlog: JobRow[], storage: KeyValueStore = fakeStorage()) {
  const html = pageView({ backlog, active: [], disqualified: [], workLog: [] }, NOW);
  const { document, Event } = parseHTML(html);
  new Function("document", "localStorage", SCRIPT)(document, storage);
  document.dispatchEvent(new Event("DOMContentLoaded"));

  const toggle = document.querySelector("[data-unjudged-toggle]") as unknown as SwitchElement;
  return {
    document,
    toggle,
    setToggle(on: boolean) {
      toggle.checked = on;
      toggle.dispatchEvent(new Event("change"));
    },
    visibleRowIds(): string[] {
      const rows = document.querySelectorAll("[data-panel='backlog'] tbody tr");
      return (Array.from(rows) as unknown as PageElement[])
        .filter((row) => !row.classList.contains("is-hidden"))
        .map((row) => row.textContent?.match(/Role (\w+)/)?.[1] ?? "");
    },
    isHidden(selector: string): boolean {
      return document.querySelector(selector)?.classList.contains("is-hidden") ?? true;
    },
  };
}

describe("the hide unjudged switch", () => {
  test("on a first visit the switch is off and unjudged jobs are shown", () => {
    const page = load([backlogJob("a", true), backlogJob("b", false)]);

    expect(page.toggle.checked).toBe(false);
    expect(page.visibleRowIds().sort()).toEqual(["a", "b"]);
  });

  test("switching it on hides every unjudged job and keeps the judged ones", () => {
    const page = load([backlogJob("a", true), backlogJob("b", false), backlogJob("c", false)]);

    page.setToggle(true);

    expect(page.visibleRowIds()).toEqual(["a"]);
  });

  test("switching it off shows every unjudged job again", () => {
    const page = load([backlogJob("a", true), backlogJob("b", false)]);

    page.setToggle(true);
    page.setToggle(false);

    expect(page.visibleRowIds().sort()).toEqual(["a", "b"]);
  });

  test("a reload in the same browser keeps the switch as it was left", () => {
    const storage = fakeStorage();
    load([backlogJob("a", true), backlogJob("b", false)], storage).setToggle(true);

    const reloaded = load([backlogJob("a", true), backlogJob("b", false)], storage);

    expect(reloaded.toggle.checked).toBe(true);
    expect(reloaded.visibleRowIds()).toEqual(["a"]);
  });

  test("hiding every job says no judged jobs remain", () => {
    const page = load([backlogJob("a", false), backlogJob("b", false)]);

    page.setToggle(true);

    expect(page.isHidden("[data-all-hidden-message]")).toBe(false);
    expect(page.isHidden("[data-panel='backlog'] .table-container")).toBe(true);
  });

  test("showing them again takes the message away", () => {
    const page = load([backlogJob("a", false)]);

    page.setToggle(true);
    page.setToggle(false);

    expect(page.isHidden("[data-all-hidden-message]")).toBe(true);
    expect(page.isHidden("[data-panel='backlog'] .table-container")).toBe(false);
  });

  test("the message stays away while a judged job is still shown", () => {
    const page = load([backlogJob("a", true), backlogJob("b", false)]);

    page.setToggle(true);

    expect(page.isHidden("[data-all-hidden-message]")).toBe(true);
  });

  test("the switch goes away on another tab and comes back on the backlog", () => {
    const page = load([backlogJob("a", false)]);
    const tab = (id: string) =>
      page.document.querySelector(`[data-tab='${id}']`) as unknown as PageElement;

    tab("active").click();
    expect(page.isHidden(".unjudged-toggle")).toBe(true);

    tab("backlog").click();
    expect(page.isHidden(".unjudged-toggle")).toBe(false);
  });
});
