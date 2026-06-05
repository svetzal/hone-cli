import { warn } from "./errors.ts";

export type JsonExtractionResult<T> =
  | { kind: "parsed"; value: T }
  | { kind: "no-json" }
  | { kind: "malformed"; raw: string };

export function warnOnMalformedJson<T>(result: JsonExtractionResult<T>, label: string): T | null {
  if (result.kind === "parsed") return result.value;
  if (result.kind === "malformed") {
    warn(`${label} contained malformed JSON: ${result.raw.slice(0, 200)}`);
  }
  return null;
}

function findBalancedJson(raw: string, openChar: string, closeChar: string): string | null {
  const start = raw.indexOf(openChar);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let isEscaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (isEscaped) {
      isEscaped = false;
      continue;
    }
    if (ch === "\\") {
      isEscaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === openChar) depth++;
    else if (ch === closeChar) depth--;
    if (depth === 0) return raw.slice(start, i + 1);
  }
  return null;
}

export function findFencedJson(
  raw: string,
  openChar: string,
  closeChar: string,
): { json: string; start: number; end: number } | null {
  const fenceOpenMatch = /```(?:json)?\s*\n?/.exec(raw);
  if (!fenceOpenMatch) return null;

  const fenceStart = fenceOpenMatch.index;
  const afterFenceHeader = fenceStart + fenceOpenMatch[0].length;
  const textAfterFence = raw.slice(afterFenceHeader);

  const openCharOffset = textAfterFence.indexOf(openChar);
  if (openCharOffset === -1) return null;

  const json = findBalancedJson(textAfterFence, openChar, closeChar);
  if (!json) return null;

  const jsonAbsEnd = afterFenceHeader + openCharOffset + json.length;
  const closingMatch = /^\s*```/.exec(raw.slice(jsonAbsEnd));
  if (!closingMatch) return null;

  return { json, start: fenceStart, end: jsonAbsEnd + closingMatch[0].length };
}

export function findBareJsonArray(raw: string): string | null {
  return findBalancedJson(raw, "[", "]");
}

export function findBareJsonObject(raw: string): string | null {
  return findBalancedJson(raw, "{", "}");
}

/**
 * Extracts a JSON array from LLM output.
 * Tries two patterns: fenced code block (```json ... ```) and bare JSON.
 * Returns a discriminated result: "parsed" with value, "no-json" if no array
 * structure was found, or "malformed" if JSON-like content was found but failed to parse.
 */
export function extractJsonArrayFromLlmOutput(raw: string): JsonExtractionResult<unknown[]> {
  let foundCandidate = false;

  // Try fenced code block first: ```json [...] ```
  const fenced = findFencedJson(raw, "[", "]");
  if (fenced) {
    foundCandidate = true;
    try {
      const parsed = JSON.parse(fenced.json);
      if (Array.isArray(parsed)) return { kind: "parsed", value: parsed };
    } catch {
      // Fall through
    }
  }

  // Try bare JSON array using bracket-counting to handle nested arrays/objects
  const bareJson = findBareJsonArray(raw);
  if (bareJson) {
    foundCandidate = true;
    try {
      const parsed = JSON.parse(bareJson);
      if (Array.isArray(parsed)) return { kind: "parsed", value: parsed };
    } catch {
      // Fall through
    }
  }

  return foundCandidate ? { kind: "malformed", raw } : { kind: "no-json" };
}

/**
 * Extracts a JSON object from LLM output.
 * Tries two patterns: fenced code block (```json ... ```) and bare JSON.
 * Returns a discriminated result: "parsed" with value, "no-json" if no object
 * structure was found, or "malformed" if JSON-like content was found but failed to parse.
 */
export function extractJsonFromLlmOutput(raw: string): JsonExtractionResult<Record<string, unknown>> {
  let foundCandidate = false;

  // Try fenced code block first: ```json ... ```
  const fenced = findFencedJson(raw, "{", "}");
  if (fenced) {
    foundCandidate = true;
    try {
      return { kind: "parsed", value: JSON.parse(fenced.json) };
    } catch {
      // Fall through
    }
  }

  // Try bare JSON object using brace-counting to handle nested objects
  const bareJson = findBareJsonObject(raw);
  if (bareJson) {
    foundCandidate = true;
    try {
      return { kind: "parsed", value: JSON.parse(bareJson) };
    } catch {
      // Fall through
    }
  }

  return foundCandidate ? { kind: "malformed", raw } : { kind: "no-json" };
}
