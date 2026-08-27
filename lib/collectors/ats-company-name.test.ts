import { describe, expect, test } from "vitest";
import {
  nameFromBoardTitle,
  resolveAtsCompanyName,
  titleFromHtml,
} from "./ats-company-name";

describe("AC 29: titleFromHtml pulls the title out of a board page", () => {
  test("finds the text inside a plain title tag", () => {
    const html = "<html><head><title>HighLevel</title></head><body></body></html>";
    expect(titleFromHtml(html)).toBe("HighLevel");
  });

  test("finds the text when the tag carries attributes", () => {
    const html = '<html><head><title data-rh="true">Hinge Health Jobs</title></head></html>';
    expect(titleFromHtml(html)).toBe("Hinge Health Jobs");
  });

  test("returns null when the document has no title tag", () => {
    const html = "<html><head></head><body>No title here</body></html>";
    expect(titleFromHtml(html)).toBeNull();
  });

  test("returns null for an empty string", () => {
    expect(titleFromHtml("")).toBeNull();
  });
});

describe("AC 29: nameFromBoardTitle strips a board title to the bare employer name", () => {
  // Real titles polled from the live boards on 2026-08-27, each paired with
  // the name it must reduce to. Adding a board is one line here.
  const measuredTitles: Array<[string, string]> = [
    ["HighLevel", "HighLevel"],
    ["US Mobile", "US Mobile"],
    ["Behaviour Interactive", "Behaviour Interactive"],
    ["Hinge Health Jobs", "Hinge Health"],
    ["Legora Jobs", "Legora"],
    ["Bjak  Jobs", "Bjak"],
    ["Voodoo  Jobs", "Voodoo"],
    ["Scorewarrior Jobs", "Scorewarrior"],
  ];

  for (const [title, expectedName] of measuredTitles) {
    test(`"${title}" becomes "${expectedName}"`, () => {
      expect(nameFromBoardTitle(title)).toBe(expectedName);
    });
  }

  test("a leading 'Careers at ' is stripped", () => {
    expect(nameFromBoardTitle("Careers at Foo")).toBe("Foo");
  });

  test("a trailing ' Careers' is stripped", () => {
    expect(nameFromBoardTitle("Foo Careers")).toBe("Foo");
  });

  test("runs of whitespace collapse to one space", () => {
    expect(nameFromBoardTitle("Foo   Bar")).toBe("Foo Bar");
  });

  test("leading and trailing whitespace is trimmed", () => {
    expect(nameFromBoardTitle("  Foo Bar  ")).toBe("Foo Bar");
  });

  test("a name ending in the letters of a decoration is left whole", () => {
    // The decoration is a separate word. Without that, Snapjobs loses its tail.
    expect(nameFromBoardTitle("Snapjobs")).toBe("Snapjobs");
  });

  test("a title that is nothing but decoration returns null", () => {
    // A board titled only "Jobs" would otherwise be written as an empty name.
    expect(nameFromBoardTitle("Jobs")).toBeNull();
  });

  test("a title of only whitespace returns null", () => {
    expect(nameFromBoardTitle("   ")).toBeNull();
  });

  test("a title holding a pipe separator returns null", () => {
    // A title listing more than the employer is not recognisably a bare name.
    expect(nameFromBoardTitle("Foo | Careers")).toBeNull();
  });

  test("a title far longer than any employer name returns null", () => {
    expect(nameFromBoardTitle("A".repeat(100))).toBeNull();
  });
});

describe("AC 31: resolveAtsCompanyName uses lookUp's answer when it has one", () => {
  test("the name is what lookUp returned", async () => {
    const lookUp = async () => "Stripe";
    const result = await resolveAtsCompanyName("greenhouse", "stripe", lookUp);
    expect(result.name).toBe("Stripe");
  });

  test("no warning is recorded", async () => {
    const lookUp = async () => "Stripe";
    const result = await resolveAtsCompanyName("greenhouse", "stripe", lookUp);
    expect(result.warnings).toEqual([]);
  });
});

describe("AC 31: resolveAtsCompanyName falls back to the slug when lookUp comes back empty", () => {
  const lookUp = async (): Promise<string | null> => null;

  test("the name is built from the slug", async () => {
    const result = await resolveAtsCompanyName("ashby", "hinge-health", lookUp);
    expect(result.name).toBe("Hinge Health");
  });

  test("exactly one warning is recorded", async () => {
    const result = await resolveAtsCompanyName("ashby", "hinge-health", lookUp);
    expect(result.warnings).toHaveLength(1);
  });

  test("the warning names the slug", async () => {
    const result = await resolveAtsCompanyName("ashby", "hinge-health", lookUp);
    expect(result.warnings[0]).toContain("hinge-health");
  });

  test("the warning names the platform", async () => {
    const result = await resolveAtsCompanyName("ashby", "hinge-health", lookUp);
    expect(result.warnings[0]).toContain("ashby");
  });
});

describe("AC 31: resolveAtsCompanyName falls back to the slug when lookUp throws", () => {
  const lookUp = async (): Promise<string | null> => {
    throw new Error("board unreachable");
  };

  test("the name is still built from the slug", async () => {
    // A name that could not be fetched must not cost the board its jobs.
    const result = await resolveAtsCompanyName("lever", "hinge-health", lookUp);
    expect(result.name).toBe("Hinge Health");
  });

  test("a warning is recorded", async () => {
    const result = await resolveAtsCompanyName("lever", "hinge-health", lookUp);
    expect(result.warnings).toHaveLength(1);
  });
});

describe("AC 31: resolveAtsCompanyName calls lookUp once", () => {
  test("a lookUp that succeeds is asked once", async () => {
    let calls = 0;
    const lookUp = async () => {
      calls += 1;
      return "Stripe";
    };
    await resolveAtsCompanyName("greenhouse", "stripe", lookUp);
    expect(calls).toBe(1);
  });

  test("a lookUp that comes back empty is asked once", async () => {
    let calls = 0;
    const lookUp = async (): Promise<string | null> => {
      calls += 1;
      return null;
    };
    await resolveAtsCompanyName("greenhouse", "stripe", lookUp);
    expect(calls).toBe(1);
  });
});
