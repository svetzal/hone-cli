import type { StructuredAssessment } from "./types.ts";
import { extractJsonFromLlmOutput } from "./json-extraction.ts";

function clampSeverity(value: number): number {
  if (!Number.isFinite(value)) return 3;
  return Math.max(1, Math.min(5, Math.round(value)));
}

function extractProse(raw: string): string {
  // Remove the JSON block (fenced or bare) and return the rest
  const withoutFenced = raw.replace(/```(?:json)?\s*\n?\s*\{[\s\S]*?\}\s*\n?\s*```/, "");
  if (withoutFenced !== raw) return withoutFenced.trim();

  const withoutBare = raw.replace(/^\s*\{[\s\S]*?\}/, "");
  if (withoutBare !== raw) return withoutBare.trim();

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
