import type { StructuredAssessment } from "./types.ts";

function clampSeverity(value: number): number {
  if (!Number.isFinite(value)) return 3;
  return Math.max(1, Math.min(5, Math.round(value)));
}

function extractJsonBlock(raw: string): Record<string, unknown> | null {
  // Try fenced code block first: ```json ... ```
  const fencedMatch = raw.match(/```(?:json)?\s*\n?\s*(\{[\s\S]*?\})\s*\n?\s*```/);
  if (fencedMatch?.[1]) {
    try {
      return JSON.parse(fencedMatch[1]);
    } catch {
      // Fall through
    }
  }

  // Try bare JSON object at the start of the text
  const bareMatch = raw.match(/^\s*(\{[\s\S]*?\})/);
  if (bareMatch?.[1]) {
    try {
      return JSON.parse(bareMatch[1]);
    } catch {
      // Fall through
    }
  }

  return null;
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
  const json = extractJsonBlock(raw);

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
