import { describe, expect, test } from "bun:test";
import { errorMessage } from "./errors.ts";

describe("errorMessage", () => {
  test("returns message from Error instance", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  test("returns string as-is", () => {
    expect(errorMessage("plain string")).toBe("plain string");
  });

  test("converts number to string", () => {
    expect(errorMessage(42)).toBe("42");
  });

  test("converts object to string", () => {
    expect(errorMessage({ code: "ENOENT" })).toBe("[object Object]");
  });
});
