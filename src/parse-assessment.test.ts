import { describe, expect, test } from "bun:test";
import { parseAssessment } from "./parse-assessment.ts";

describe("parseAssessment", () => {
  test("parses well-formed JSON + prose", () => {
    const raw = [
      '```json',
      '{ "severity": 4, "principle": "Single Responsibility", "category": "architecture" }',
      '```',
      '',
      'The project has several classes that handle too many concerns.',
    ].join("\n");

    const result = parseAssessment(raw);

    expect(result.severity).toBe(4);
    expect(result.principle).toBe("Single Responsibility");
    expect(result.category).toBe("architecture");
    expect(result.prose).toContain("several classes");
    expect(result.raw).toBe(raw);
  });

  test("parses JSON in fenced code block without json tag", () => {
    const raw = [
      '```',
      '{ "severity": 2, "principle": "DRY", "category": "duplication" }',
      '```',
      '',
      'There is some code duplication.',
    ].join("\n");

    const result = parseAssessment(raw);

    expect(result.severity).toBe(2);
    expect(result.principle).toBe("DRY");
    expect(result.category).toBe("duplication");
  });

  test("parses bare JSON at start of text", () => {
    const raw = [
      '{ "severity": 5, "principle": "Security", "category": "security" }',
      '',
      'Critical security vulnerability found.',
    ].join("\n");

    const result = parseAssessment(raw);

    expect(result.severity).toBe(5);
    expect(result.principle).toBe("Security");
    expect(result.category).toBe("security");
    expect(result.prose).toContain("Critical security");
  });

  test("falls back on missing fields", () => {
    const raw = [
      '```json',
      '{ "severity": 4 }',
      '```',
      '',
      'Assessment text here.',
    ].join("\n");

    const result = parseAssessment(raw);

    expect(result.severity).toBe(4);
    expect(result.principle).toBe("unknown");
    expect(result.category).toBe("other");
  });

  test("falls back when no JSON at all", () => {
    const raw = "The project has several issues that need to be addressed.";

    const result = parseAssessment(raw);

    expect(result.severity).toBe(3);
    expect(result.principle).toBe("unknown");
    expect(result.category).toBe("other");
    expect(result.prose).toBe(raw);
    expect(result.raw).toBe(raw);
  });

  test("clamps severity below 1 to 1", () => {
    const raw = '{ "severity": 0, "principle": "test", "category": "test" }\nSome text.';

    const result = parseAssessment(raw);
    expect(result.severity).toBe(1);
  });

  test("clamps severity above 5 to 5", () => {
    const raw = '{ "severity": 10, "principle": "test", "category": "test" }\nSome text.';

    const result = parseAssessment(raw);
    expect(result.severity).toBe(5);
  });

  test("handles non-numeric severity gracefully", () => {
    const raw = '{ "severity": "high", "principle": "test", "category": "test" }\nSome text.';

    const result = parseAssessment(raw);
    expect(result.severity).toBe(3); // falls back to default
  });

  test("handles invalid JSON gracefully", () => {
    const raw = '```json\n{invalid json}\n```\nSome assessment.';

    const result = parseAssessment(raw);
    expect(result.severity).toBe(3);
    expect(result.principle).toBe("unknown");
    expect(result.prose).toBe(raw.trim());
  });
});
