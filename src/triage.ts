import { buildClaudeArgs } from "./claude.ts";
import { extractJsonFromLlmOutput } from "./json-extraction.ts";
import type { ClaudeInvoker, StructuredAssessment, TriageResult } from "./types.ts";

export function checkSeverityThreshold(
  severity: number,
  threshold: number,
): { passed: boolean; reason: string } {
  if (severity < threshold) {
    return {
      passed: false,
      reason: `Severity ${severity} is below threshold ${threshold}`,
    };
  }
  return { passed: true, reason: "" };
}

export function buildTriagePrompt(assessment: string, principle: string): string {
  return [
    "You are a skeptical code review triage system. Your job is to determine whether a proposed",
    "code improvement is substantive or busy-work. When in doubt, classify as busy-work.",
    "",
    "Busy-work signals (reject if any apply):",
    "- Adding comments or docstrings to unchanged logic",
    "- Reorganizing imports or file structure without behavioral change",
    "- Adding abstractions for single-use code",
    "- Adding error handling for internal or impossible cases",
    "- Type annotation campaigns on stable code",
    '- "Consistency" refactors that don\'t fix bugs or enable features',
    "- Cosmetic renaming without functional benefit",
    "",
    `Principle violated: ${principle}`,
    "",
    "Assessment:",
    assessment,
    "",
    "Respond with ONLY a JSON object:",
    '```json',
    '{ "changeType": "<category>", "busyWork": <true|false>, "reason": "<brief explanation>" }',
    '```',
    "",
    "changeType should be one of: feature, bugfix, security, performance, architecture, testing, documentation, cosmetic, organization",
  ].join("\n");
}

export function parseTriageResponse(raw: string): {
  changeType: string;
  busyWork: boolean;
  reason: string;
} {
  const json = extractJsonFromLlmOutput(raw);
  if (!json) {
    // Fail-open: don't block real work on parse errors
    return { changeType: "other", busyWork: false, reason: "Failed to parse triage response" };
  }

  return {
    changeType: typeof json.changeType === "string" ? json.changeType : "other",
    busyWork: typeof json.busyWork === "boolean" ? json.busyWork : false,
    reason: typeof json.reason === "string" ? json.reason : "",
  };
}

export async function triage(
  assessment: StructuredAssessment,
  threshold: number,
  model: string,
  readOnlyTools: string,
  claude: ClaudeInvoker,
): Promise<TriageResult> {
  // Step 1: Severity threshold (no LLM)
  const severityCheck = checkSeverityThreshold(assessment.severity, threshold);
  if (!severityCheck.passed) {
    return {
      accepted: false,
      reason: severityCheck.reason,
      severity: assessment.severity,
      changeType: "unknown",
      busyWork: false,
    };
  }

  // Step 2: LLM-based busy-work detection
  const prompt = buildTriagePrompt(assessment.prose, assessment.principle);
  const args = buildClaudeArgs({
    model,
    prompt,
    readOnly: true,
    readOnlyTools,
  });
  const raw = await claude(args);
  const parsed = parseTriageResponse(raw);

  if (parsed.busyWork) {
    return {
      accepted: false,
      reason: `Busy-work: ${parsed.reason}`,
      severity: assessment.severity,
      changeType: parsed.changeType,
      busyWork: true,
    };
  }

  return {
    accepted: true,
    reason: parsed.reason,
    severity: assessment.severity,
    changeType: parsed.changeType,
    busyWork: false,
  };
}
