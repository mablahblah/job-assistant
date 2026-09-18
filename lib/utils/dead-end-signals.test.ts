import { describe, expect, test } from "vitest";
import { detectDeadEndSignals } from "./dead-end-signals";

describe("AC 36: a page carrying a password input is a dead end", () => {
  test("a login form reads as a login wall", () => {
    const html = '<form><input type="password" name="pass"><button>Log in</button></form>';
    expect(detectDeadEndSignals(html)).toEqual({ isDeadEnd: true, reason: "login_wall" });
  });
});

describe("AC 37: a page carrying a signup wall is a dead end", () => {
  test("an account-creation prompt reads as a signup wall", () => {
    const html = "<div>Create an account to view this job posting</div>";
    expect(detectDeadEndSignals(html)).toEqual({ isDeadEnd: true, reason: "signup_wall" });
  });

  test("a sign-up-to-access prompt reads as a signup wall", () => {
    const html = "<div>Sign up to access job details</div>";
    expect(detectDeadEndSignals(html)).toEqual({ isDeadEnd: true, reason: "signup_wall" });
  });
});

describe("AC 38: a page carrying a paywall is a dead end", () => {
  test("a subscription prompt reads as a paywall", () => {
    const html = "<div>Subscribe to view full job listing</div>";
    expect(detectDeadEndSignals(html)).toEqual({ isDeadEnd: true, reason: "paywall" });
  });

  test("a free-trial prompt reads as a paywall", () => {
    const html = "<div>Start your free trial to unlock all jobs</div>";
    expect(detectDeadEndSignals(html)).toEqual({ isDeadEnd: true, reason: "paywall" });
  });

  test("an upgrade prompt reads as a paywall", () => {
    const html = "<div>Upgrade to unlock this posting</div>";
    expect(detectDeadEndSignals(html)).toEqual({ isDeadEnd: true, reason: "paywall" });
  });
});

describe("AC 39: an ordinary job posting is not a dead end", () => {
  test("a posting with a description and an apply link passes", () => {
    const html =
      '<div><h1>Senior Product Designer</h1><p>We are looking for...</p><a href="/apply">Apply Now</a></div>';
    expect(detectDeadEndSignals(html)).toEqual({ isDeadEnd: false });
  });

  test("a newsletter signup in the footer is not a signup wall", () => {
    const html =
      "<div><h1>Product Designer</h1><p>Great role!</p><footer>Sign up for our newsletter</footer></div>";
    expect(detectDeadEndSignals(html)).toEqual({ isDeadEnd: false });
  });
});
