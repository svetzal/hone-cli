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

  // Try bare JSON object
  const bareMatch = raw.match(/(\{[\s\S]*?\})/);
  if (bareMatch?.[1]) {
    try {
      return JSON.parse(bareMatch[1]);
    } catch {
      // Fall through
    }
  }

  return null;
}
