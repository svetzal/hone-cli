export type JsonExtractionResult<T> =
  | { kind: "parsed"; value: T }
  | { kind: "no-json" }
  | { kind: "malformed"; raw: string };

/**
 * Locates the first complete JSON array in a string using bracket-counting,
 * respecting string literals (including escaped characters).
 * Returns the raw JSON substring, or null if no complete array is found.
 */
export function findBareJsonArray(raw: string): string | null {
  const start = raw.indexOf("[");
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
    if (ch === "[") depth++;
    else if (ch === "]") depth--;
    if (depth === 0) return raw.slice(start, i + 1);
  }
  return null;
}

/**
 * Locates the first complete JSON object in a string using brace-counting,
 * respecting string literals (including escaped characters).
 * Returns the raw JSON substring, or null if no complete object is found.
 */
export function findBareJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
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
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    if (depth === 0) return raw.slice(start, i + 1);
  }
  return null;
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
  const fencedMatch = raw.match(/```(?:json)?\s*\n?\s*(\[[\s\S]*?\])\s*\n?\s*```/);
  if (fencedMatch?.[1]) {
    foundCandidate = true;
    try {
      const parsed = JSON.parse(fencedMatch[1]);
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
  const fencedMatch = raw.match(/```(?:json)?\s*\n?\s*(\{[\s\S]*?\})\s*\n?\s*```/);
  if (fencedMatch?.[1]) {
    foundCandidate = true;
    try {
      return { kind: "parsed", value: JSON.parse(fencedMatch[1]) };
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
