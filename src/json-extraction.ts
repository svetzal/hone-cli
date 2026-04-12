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
 * Extracts a JSON object from LLM output.
 * Tries two patterns: fenced code block (```json ... ```) and bare JSON.
 * This is the single source of truth for "how to extract JSON from LLM output".
 */
export function extractJsonFromLlmOutput(raw: string): Record<string, unknown> | null {
  // Try fenced code block first: ```json ... ```
  const fencedMatch = raw.match(/```(?:json)?\s*\n?\s*(\{[\s\S]*?\})\s*\n?\s*```/);
  if (fencedMatch?.[1]) {
    try {
      return JSON.parse(fencedMatch[1]);
    } catch {
      // Fall through
    }
  }

  // Try bare JSON object using brace-counting to handle nested objects
  const bareJson = findBareJsonObject(raw);
  if (bareJson) {
    try {
      return JSON.parse(bareJson);
    } catch {
      // Fall through
    }
  }

  return null;
}
