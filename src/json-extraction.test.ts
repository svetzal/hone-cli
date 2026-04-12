import { describe, expect, test } from "bun:test";
import { extractJsonFromLlmOutput, findBareJsonObject } from "./json-extraction.ts";

describe("extractJsonFromLlmOutput", () => {
  describe("fenced code block extraction", () => {
    test("extracts JSON from ```json fenced block", () => {
      const raw = '```json\n{ "key": "value" }\n```';
      const result = extractJsonFromLlmOutput(raw);
      expect(result).toEqual({ key: "value" });
    });

    test("extracts JSON from ``` fenced block without json tag", () => {
      const raw = '```\n{ "key": "value" }\n```';
      const result = extractJsonFromLlmOutput(raw);
      expect(result).toEqual({ key: "value" });
    });

    test("extracts JSON from fenced block with surrounding text", () => {
      const raw = 'Here is the result:\n```json\n{ "severity": 4 }\n```\nSome more text.';
      const result = extractJsonFromLlmOutput(raw);
      expect(result).toEqual({ severity: 4 });
    });

    test("handles whitespace around JSON in fenced block", () => {
      const raw = '```json\n  { "key": "value" }  \n```';
      const result = extractJsonFromLlmOutput(raw);
      expect(result).toEqual({ key: "value" });
    });
  });

  describe("bare JSON extraction", () => {
    test("extracts bare JSON object", () => {
      const raw = '{ "key": "value" }';
      const result = extractJsonFromLlmOutput(raw);
      expect(result).toEqual({ key: "value" });
    });

    test("extracts bare JSON with surrounding text", () => {
      const raw = 'Some text before { "key": "value" } and after.';
      const result = extractJsonFromLlmOutput(raw);
      expect(result).toEqual({ key: "value" });
    });
  });

  describe("error handling", () => {
    test("returns null for no JSON content", () => {
      const result = extractJsonFromLlmOutput("No JSON here at all.");
      expect(result).toBeNull();
    });

    test("returns null for empty string", () => {
      const result = extractJsonFromLlmOutput("");
      expect(result).toBeNull();
    });

    test("returns null for invalid JSON in fenced block", () => {
      const raw = "```json\n{invalid json}\n```";
      const result = extractJsonFromLlmOutput(raw);
      // Falls through fenced, tries bare — bare also fails to parse
      expect(result).toBeNull();
    });

    test("falls through from invalid fenced to bare JSON", () => {
      // Fenced block match fails JSON.parse, bare match picks up the fenced content
      const raw = '```json\n{not: valid}\n```\n{ "key": "value" }';
      // The bare regex may match the first {...} (fenced content) which is invalid,
      // so the entire extraction returns null
      const result = extractJsonFromLlmOutput(raw);
      expect(result).toBeNull();
    });

    test("returns null when only arrays are present (not objects)", () => {
      const raw = "[1, 2, 3]";
      // The regex looks for { ... } so arrays are not matched
      const result = extractJsonFromLlmOutput(raw);
      expect(result).toBeNull();
    });
  });

  describe("complex JSON", () => {
    test("handles nested JSON objects via brace-counting", () => {
      const raw = '{ "outer": { "inner": true } }';
      const result = extractJsonFromLlmOutput(raw);
      expect(result).toEqual({ outer: { inner: true } });
    });

    test("handles deeply nested JSON objects", () => {
      const raw = '{ "a": { "b": { "c": 1 } } }';
      const result = extractJsonFromLlmOutput(raw);
      expect(result).toEqual({ a: { b: { c: 1 } } });
    });

    test("handles nested JSON with surrounding text", () => {
      const raw = 'Result: { "config": { "enabled": true }, "count": 5 } done.';
      const result = extractJsonFromLlmOutput(raw);
      expect(result).toEqual({ config: { enabled: true }, count: 5 });
    });

    test("handles braces inside JSON string values", () => {
      const raw = '{ "message": "use {} for objects", "ok": true }';
      const result = extractJsonFromLlmOutput(raw);
      expect(result).toEqual({ message: "use {} for objects", ok: true });
    });

    test("extracts object with multiple fields", () => {
      const raw = '```json\n{ "severity": 4, "principle": "SRP", "category": "architecture" }\n```';
      const result = extractJsonFromLlmOutput(raw);
      expect(result).toEqual({ severity: 4, principle: "SRP", category: "architecture" });
    });

    test("extracts object with boolean and null values", () => {
      const raw = '{ "busyWork": true, "reason": null }';
      const result = extractJsonFromLlmOutput(raw);
      expect(result).toEqual({ busyWork: true, reason: null });
    });
  });
});

describe("findBareJsonObject", () => {
  test("finds a simple object", () => {
    expect(findBareJsonObject('{ "key": "value" }')).toBe('{ "key": "value" }');
  });

  test("finds object with surrounding text", () => {
    expect(findBareJsonObject('prefix { "key": 1 } suffix')).toBe('{ "key": 1 }');
  });

  test("finds nested object correctly", () => {
    expect(findBareJsonObject('{ "a": { "b": true } }')).toBe('{ "a": { "b": true } }');
  });

  test("handles braces inside string values", () => {
    expect(findBareJsonObject('{ "msg": "use {}" }')).toBe('{ "msg": "use {}" }');
  });

  test("returns null when no opening brace", () => {
    expect(findBareJsonObject("no json here")).toBeNull();
  });

  test("returns null when braces are unbalanced", () => {
    expect(findBareJsonObject('{ "key": "value"')).toBeNull();
  });
});
