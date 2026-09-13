import { describe, expect, test } from "vitest";
import { urlAnnouncesError } from "./url-error-flag";

describe("a web address that says the posting is gone", () => {
  test("an error flag set true is an announcement", () => {
    expect(urlAnnouncesError("https://job-boards.greenhouse.io/gusto?error=true")).toBe(true);
  });

  test("the flag is read whatever truthy value it carries", () => {
    expect(urlAnnouncesError("https://board.example/acme?error=1")).toBe(true);
    expect(urlAnnouncesError("https://board.example/acme?error=job_not_found")).toBe(true);
  });

  test("the flag is read whatever else the address carries", () => {
    expect(urlAnnouncesError("https://board.example/acme?src=email&error=true&x=1")).toBe(true);
  });

  test("a flag set to a falsy value announces nothing", () => {
    expect(urlAnnouncesError("https://board.example/acme?error=false")).toBe(false);
    expect(urlAnnouncesError("https://board.example/acme?error=0")).toBe(false);
    expect(urlAnnouncesError("https://board.example/acme?error=")).toBe(false);
  });

  test("an ordinary posting address announces nothing", () => {
    expect(urlAnnouncesError("https://job-boards.greenhouse.io/gusto/jobs/6177443004")).toBe(false);
  });

  test("the word error elsewhere in the address is not the flag", () => {
    // A posting for an error-handling role, or a path segment spelled that
    // way, must not be thrown away.
    expect(urlAnnouncesError("https://employer.example/jobs/error-handling-engineer")).toBe(false);
    expect(urlAnnouncesError("https://employer.example/jobs/1?errorless=true")).toBe(false);
  });

  test("an address that cannot be parsed announces nothing", () => {
    // Judging an unreadable address as an error would throw away a posting on
    // the strength of a parsing failure.
    expect(urlAnnouncesError("not a url at all")).toBe(false);
  });
});
