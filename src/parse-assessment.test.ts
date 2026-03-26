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

  test("rounds fractional severity", () => {
    const raw = '{ "severity": 3.7, "principle": "test", "category": "test" }\nSome text.';

    const result = parseAssessment(raw);
    expect(result.severity).toBe(4);
  });

  test("clamps negative severity to 1", () => {
    const raw = '{ "severity": -5, "principle": "test", "category": "test" }\nSome text.';

    const result = parseAssessment(raw);
    expect(result.severity).toBe(1);
  });

  test("handles NaN severity with default", () => {
    const raw = '{ "severity": NaN, "principle": "test", "category": "test" }';
    // NaN is not valid JSON, so JSON.parse won't produce this — but Infinity test:
    // This raw string won't parse as JSON, falls back to no-JSON path
    const result = parseAssessment(raw);
    expect(result.severity).toBe(3);
  });

  test("extracts prose after removing fenced JSON block", () => {
    const raw = [
      '```json',
      '{ "severity": 4, "principle": "DRY", "category": "duplication" }',
      '```',
      '',
      'This is the prose assessment.',
      'It spans multiple lines.',
    ].join("\n");

    const result = parseAssessment(raw);
    expect(result.prose).toContain("This is the prose assessment.");
    expect(result.prose).toContain("It spans multiple lines.");
    expect(result.prose).not.toContain("```");
  });

  test("extracts prose after removing bare JSON block", () => {
    const raw = [
      '{ "severity": 3, "principle": "KISS", "category": "complexity" }',
      '',
      'The code is overly complex.',
    ].join("\n");

    const result = parseAssessment(raw);
    expect(result.prose).toContain("The code is overly complex.");
    expect(result.prose).not.toContain('"severity"');
  });

  test("uses raw as prose when JSON removal produces empty string", () => {
    const raw = '```json\n{ "severity": 4, "principle": "test", "category": "test" }\n```';

    const result = parseAssessment(raw);
    // extractProse returns empty after removal, so prose falls back to raw.trim()
    expect(result.prose).toBe(raw.trim());
  });

  test("handles non-string principle field", () => {
    const raw = '{ "severity": 3, "principle": 42, "category": "test" }';

    const result = parseAssessment(raw);
    expect(result.principle).toBe("unknown");
  });

  test("handles non-string category field", () => {
    const raw = '{ "severity": 3, "principle": "test", "category": true }';

    const result = parseAssessment(raw);
    expect(result.category).toBe("other");
  });

  test("extracts prose when bare JSON contains nested objects", () => {
    const raw = [
      '{ "severity": 3, "principle": "test", "category": "test", "meta": { "source": "auto" } }',
      '',
      'The code needs improvement.',
    ].join("\n");

    const result = parseAssessment(raw);
    expect(result.prose).toContain("The code needs improvement.");
    expect(result.prose).not.toContain('"severity"');
  });
});
