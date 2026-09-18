import { describe, expect, test } from "vitest";
import { messageFromThrown } from "./thrown-message";

describe("a thrown Error", () => {
  test("gives its message", () => {
    expect(messageFromThrown(new Error("network down"))).toBe("network down");
  });
});

describe("a thrown string", () => {
  test("gives itself, because it is already the message", () => {
    expect(messageFromThrown("network down")).toBe("network down");
  });
});

describe("a thrown plain object", () => {
  // The failure this whole module exists to prevent: String() flattens an
  // object to "[object Object]", which names nothing and cannot be searched.
  test("gives its contents rather than [object Object]", () => {
    expect(messageFromThrown({ code: "ECONNRESET" })).toBe('{"code":"ECONNRESET"}');
  });

  test("names the failure, so a reader can tell one cause from another", () => {
    expect(messageFromThrown({ code: "ETIMEDOUT" })).not.toBe(
      messageFromThrown({ code: "ECONNRESET" })
    );
  });
});

describe("a thrown undefined", () => {
  test('gives the word "undefined" rather than an empty message', () => {
    expect(messageFromThrown(undefined)).toBe("undefined");
  });
});

describe("a thrown null", () => {
  test('gives the word "null" rather than an empty message', () => {
    expect(messageFromThrown(null)).toBe("null");
  });
});

describe("a thrown value JSON cannot render", () => {
  // A circular object makes JSON.stringify throw. Rendering it poorly beats
  // replacing the original failure with a second one.
  test("falls back rather than throwing a second time", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => messageFromThrown(circular)).not.toThrow();
    expect(messageFromThrown(circular)).toBe("[object Object]");
  });
});
