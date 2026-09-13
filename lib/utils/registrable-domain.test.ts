import { describe, expect, test } from "vitest";
import { registrableDomainFromUrl } from "./registrable-domain";

describe("registrableDomainFromUrl: every sub-address of one source gives one owned domain", () => {
  test("all three Greenhouse hosts give greenhouse.io", () => {
    expect(registrableDomainFromUrl("https://boards.greenhouse.io/acme/jobs/1")).toBe(
      "greenhouse.io",
    );
    expect(registrableDomainFromUrl("https://job-boards.greenhouse.io/acme/jobs/1")).toBe(
      "greenhouse.io",
    );
    expect(registrableDomainFromUrl("https://job-boards.eu.greenhouse.io/acme/jobs/1")).toBe(
      "greenhouse.io",
    );
  });

  test("two employers on one Workday platform give the same owned domain", () => {
    expect(registrableDomainFromUrl("https://meredith.wd5.myworkdayjobs.com/jobs/1")).toBe(
      registrableDomainFromUrl("https://kroger.wd2.myworkdayjobs.com/jobs/9"),
    );
  });

  test("a host that is already the owned domain gives itself", () => {
    expect(registrableDomainFromUrl("https://lever.co/acme/1")).toBe("lever.co");
  });
});

describe("registrableDomainFromUrl: the owned domain is more than the last two labels", () => {
  test("a two-part public suffix keeps the label its owner registered", () => {
    expect(registrableDomainFromUrl("https://www.adzuna.co.uk/jobs/1")).toBe("adzuna.co.uk");
  });
});

describe("registrableDomainFromUrl: an address with no owned domain gives nothing", () => {
  test("a bare IP address gives nothing", () => {
    expect(registrableDomainFromUrl("https://192.168.1.1/jobs/1")).toBe(null);
  });

  test("a host that is only a public suffix gives nothing", () => {
    expect(registrableDomainFromUrl("https://co.uk/jobs/1")).toBe(null);
  });

  test("localhost gives nothing", () => {
    expect(registrableDomainFromUrl("http://localhost:3000/jobs/1")).toBe(null);
  });
});

describe("registrableDomainFromUrl: anything that is not a web address gives nothing", () => {
  test("a plain word gives nothing rather than throwing", () => {
    expect(registrableDomainFromUrl("not-a-url")).toBe(null);
  });

  test("an empty string gives nothing", () => {
    expect(registrableDomainFromUrl("")).toBe(null);
  });

  test("a link that is not a web address gives nothing", () => {
    expect(registrableDomainFromUrl("mailto:jobs@acme.com")).toBe(null);
  });
});

describe("registrableDomainFromUrl: the answer does not depend on how the host was typed", () => {
  test("an upper-case host gives the same owned domain as a lower-case one", () => {
    expect(registrableDomainFromUrl("https://JOBS.Greenhouse.IO/acme/1")).toBe("greenhouse.io");
  });
});
