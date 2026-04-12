import { extractJsonFromLlmOutput, findBareJsonObject } from "./json-extraction.ts";
import type { StructuredAssessment } from "./types.ts";

function clampSeverity(value: number): number {
  if (!Number.isFinite(value)) return 3;
  return Math.max(1, Math.min(5, Math.round(value)));
}

function extractProse(raw: string): string {
  // Remove fenced JSON block (```json ... ```) and return the rest
  const withoutFenced = raw.replace(/```(?:json)?\s*\n?\s*\{[\s\S]*?\}\s*\n?\s*```/, "");
  if (withoutFenced !== raw) return withoutFenced.trim();

  // Remove bare JSON object using brace-counting to handle nested objects
  const bareJson = findBareJsonObject(raw);
  if (bareJson) {
    const withoutBare = raw.replace(bareJson, "");
    if (withoutBare !== raw) return withoutBare.trim();
  }

  return raw.trim();
}

export function parseAssessment(raw: string): StructuredAssessment {
  const json = extractJsonFromLlmOutput(raw);

  if (json) {
    const severity = typeof json.severity === "number" ? clampSeverity(json.severity) : 3;
    const principle = typeof json.principle === "string" ? json.principle : "unknown";
    const category = typeof json.category === "string" ? json.category : "other";
    const prose = extractProse(raw) || raw.trim();

    return { severity, principle, category, prose, raw };
  }

  // Fallback: no JSON found
  return {
    severity: 3,
    principle: "unknown",
    category: "other",
    prose: raw.trim(),
    raw,
  };
}
