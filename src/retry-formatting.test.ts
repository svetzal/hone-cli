import { describe, expect, test } from "bun:test";
import { formatGateFailures, appendRetryHistory } from "./retry-formatting.ts";

describe("formatGateFailures", () => {
  test("formats a single gate as a markdown section", () => {
    const result = formatGateFailures([{ name: "test", output: "1 failed" }]);
    expect(result).toBe("### Gate: test\n\n1 failed");
  });

  test("joins multiple gates with double newlines", () => {
    const result = formatGateFailures([
      { name: "test", output: "1 failed" },
      { name: "lint", output: "2 warnings" },
    ]);
    expect(result).toBe("### Gate: test\n\n1 failed\n\n### Gate: lint\n\n2 warnings");
  });

  test("returns empty string for an empty array", () => {
    expect(formatGateFailures([])).toBe("");
  });
});

describe("appendRetryHistory", () => {
  test("appends current failed gates section", () => {
    const sections: string[] = [];
    appendRetryHistory(sections, [], [{ name: "test", output: "failed" }]);
    expect(sections).toEqual(["", "## Current Failed Gates", "", "### Gate: test\n\nfailed"]);
  });

  test("prepends prior attempt sections before current failures", () => {
    const sections: string[] = [];
    appendRetryHistory(
      sections,
      [{ attempt: 1, failedGates: [{ name: "lint", output: "err" }] }],
      [{ name: "test", output: "failed" }],
    );
    expect(sections[1]).toBe("## Attempt 1");
    const currentIdx = sections.indexOf("## Current Failed Gates");
    expect(currentIdx).toBeGreaterThan(sections.indexOf("## Attempt 1"));
  });

  test("handles empty prior attempts (only current failures)", () => {
    const sections = ["existing"];
    appendRetryHistory(sections, [], [{ name: "typecheck", output: "err" }]);
    expect(sections[0]).toBe("existing");
    expect(sections).toContain("## Current Failed Gates");
  });

  test("preserves existing sections before appending", () => {
    const sections = ["## Goal", "", "Fix something"];
    appendRetryHistory(sections, [], [{ name: "test", output: "out" }]);
    expect(sections[0]).toBe("## Goal");
  });

  test("handles multiple prior attempts in order", () => {
    const sections: string[] = [];
    appendRetryHistory(
      sections,
      [
        { attempt: 1, failedGates: [{ name: "test", output: "err1" }] },
        { attempt: 2, failedGates: [{ name: "lint", output: "err2" }] },
      ],
      [{ name: "test", output: "err3" }],
    );
    expect(sections).toContain("## Attempt 1");
    expect(sections).toContain("## Attempt 2");
    expect(sections).toContain("## Current Failed Gates");
    const attempt1Idx = sections.indexOf("## Attempt 1");
    const attempt2Idx = sections.indexOf("## Attempt 2");
    const currentIdx = sections.indexOf("## Current Failed Gates");
    expect(attempt1Idx).toBeLessThan(attempt2Idx);
    expect(attempt2Idx).toBeLessThan(currentIdx);
  });

  test("formats gate failures within prior attempts correctly", () => {
    const sections: string[] = [];
    appendRetryHistory(
      sections,
      [{ attempt: 1, failedGates: [{ name: "test", output: "FAIL: err" }] }],
      [],
    );
    expect(sections).toContain("### Gate: test\n\nFAIL: err");
  });
});
