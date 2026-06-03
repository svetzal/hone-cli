import { invokeReadOnlyStage } from "./claude.ts";
import { extractJsonFromLlmOutput, warnOnMalformedJson } from "./json-extraction.ts";
import { PROMPT_ANCHORS } from "./prompt-anchors.ts";
import type { ClaudeContext, StructuredAssessment, TriageResult } from "./types.ts";

export function checkSeverityThreshold(severity: number, threshold: number): { passed: boolean; reason: string } {
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
    `${PROMPT_ANCHORS.triage}. Your job is to determine whether a proposed`,
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
    "```json",
    '{ "changeType": "<category>", "busyWork": <true|false>, "reason": "<brief explanation>" }',
    "```",
    "",
    "changeType should be one of: feature, bugfix, security, performance, architecture, testing, documentation, cosmetic, organization",
  ].join("\n");
}

export function parseTriageResponse(raw: string): {
  changeType: string;
  busyWork: boolean;
  reason: string;
} {
  const result = extractJsonFromLlmOutput(raw);
  const json = warnOnMalformedJson(result, "Triage response");
  if (!json) {
    return {
      changeType: "unparseable",
      busyWork: true,
      reason: "Unparseable triage response — failing closed (treated as busy-work)",
    };
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
  ctx: ClaudeContext,
): Promise<TriageResult> {
  const { model, readOnlyTools, claude } = ctx;
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
  const raw = await invokeReadOnlyStage({ model, readOnlyTools, claude }, prompt);
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
