import { describe, expect, test } from "bun:test";
import { extractJsonFromLlmOutput } from "./json-extraction.ts";

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
      const raw = '```json\n{invalid json}\n```';
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
    test("non-greedy regex stops at first closing brace for nested objects", () => {
      const raw = '{ "outer": { "inner": true } }';
      // Non-greedy .*? stops at first }, producing { "outer": { "inner": true }
      // which is invalid JSON — returns null
      const result = extractJsonFromLlmOutput(raw);
      expect(result).toBeNull();
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
