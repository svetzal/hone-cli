import type { ClaudeInvoker, CharterCheckResult, StructuredAssessment, TriageResult, GateDefinition, GatesRunResult } from "./types.ts";

/**
 * Extract the prompt string from a Claude CLI args array.
 * Single source of truth for how prompts are encoded in args.
 */
export function extractPrompt(args: string[]): string {
  const idx = args.indexOf("-p");
  return idx >= 0 ? args[idx + 1] ?? "" : "";
}

/**
 * Stage responses for the iterate workflow mock.
 * Maps each stage to the string the mock should return.
 */
export interface IterateStageResponses {
  assess: string;
  name: string;
  plan: string;
  execute: string;
  triage?: string;
}

/**
 * Creates a mock ClaudeInvoker that dispatches based on iterate stage prompts.
 * Consolidates the prompt-prefix dispatch logic into one place.
 *
 * Options:
 * - `onCall`: optional callback invoked with each call's args (for assertions)
 */
export function createIterateMock(
  responses: IterateStageResponses,
  opts?: { onCall?: (args: string[]) => void },
): ClaudeInvoker {
  return async (args) => {
    opts?.onCall?.(args);
    const prompt = extractPrompt(args);

    if (prompt.startsWith("Assess")) return responses.assess;
    if (prompt.startsWith("Output ONLY")) return responses.name;
    if (prompt.startsWith("You are a skeptical")) return responses.triage ?? "";
    if (prompt.startsWith("Based on")) return responses.plan;
    if (prompt.startsWith("Execute") || prompt.startsWith("The previous execution")) {
      return responses.execute;
    }
    return "";
  };
}

/**
 * Creates a mock ClaudeInvoker for the derive workflow.
 * The derive workflow makes 2 calls: derive (project inspection) and gate extraction.
 */
export function createDeriveMock(
  responses: { derive: string; gateExtraction: string },
  opts?: { onCall?: (args: string[]) => void },
): ClaudeInvoker {
  return async (args) => {
    opts?.onCall?.(args);
    const prompt = extractPrompt(args);

    if (prompt.includes("inspecting a software project")) {
      return responses.derive;
    }
    // Gate extraction call
    return responses.gateExtraction;
  };
}

/**
 * Mock gate resolver that returns empty gates (no Claude call needed).
 * Used by both iterate and github-iterate tests.
 */
export const emptyGateResolver = async () => [] as GateDefinition[];

/**
 * Mock gate resolver that returns a standard test gate.
 * Used by both iterate and github-iterate tests.
 */
export const standardGateResolver = async () => [
  { name: "test", command: "npm test", required: true },
] as GateDefinition[];

/**
 * Mock charter checker that always passes.
 * Used by both iterate and github-iterate tests.
 */
export const passingCharterChecker = async (): Promise<CharterCheckResult> => ({
  passed: true,
  sources: [{ file: "CHARTER.md", length: 200, sufficient: true }],
  guidance: [],
});

/**
 * Mock charter checker that always fails.
 * Used by both iterate and github-iterate tests.
 */
export const failingCharterChecker = async (): Promise<CharterCheckResult> => ({
  passed: false,
  sources: [],
  guidance: ["Add a CHARTER.md describing the project's goals"],
});

/**
 * Mock triage runner that always accepts proposals.
 * Used by both iterate and github-iterate tests.
 */
export const acceptingTriageRunner = async (): Promise<TriageResult> => ({
  accepted: true,
  reason: "Substantive change",
  severity: 4,
  changeType: "architecture",
  busyWork: false,
});

/**
 * Mock triage runner that rejects based on severity threshold.
 * Used by both iterate and github-iterate tests.
 */
export const rejectingSeverityTriageRunner = async (
  assessment: StructuredAssessment,
  threshold: number,
): Promise<TriageResult> => ({
  accepted: false,
  reason: `Severity ${assessment.severity} is below threshold ${threshold}`,
  severity: assessment.severity,
  changeType: "unknown",
  busyWork: false,
});

/**
 * Mock triage runner that rejects as busy-work.
 * Used by both iterate and github-iterate tests.
 */
export const rejectingBusyWorkTriageRunner = async (): Promise<TriageResult> => ({
  accepted: false,
  reason: "Busy-work: Just adding comments",
  severity: 4,
  changeType: "cosmetic",
  busyWork: true,
});

/**
 * Alternative triage runner that rejects everything.
 * Used by github-iterate tests.
 */
export const rejectingTriageRunner = async (): Promise<TriageResult> => ({
  accepted: false,
  reason: "Busy-work",
  severity: 2,
  changeType: "cosmetic",
  busyWork: true,
});

/**
 * Creates a gate runner that passes on the first call (preflight) and
 * delegates to a provided sequence for subsequent calls (post-execute verify).
 *
 * @param postPreflightResults - Array of results to return for calls after preflight.
 *   Cycles through the array in order; the last entry repeats for any extra calls.
 */
export function createPreflightAwareGateRunner(
  postPreflightResults: GatesRunResult[],
): { runner: (gates: GateDefinition[], projectDir: string, timeout: number) => Promise<GatesRunResult>; callCount: () => number } {
  let calls = 0;

  const runner = async (): Promise<GatesRunResult> => {
    const idx = calls;
    calls++;

    if (idx === 0) {
      // Preflight call — always passes
      return { allPassed: true, requiredPassed: true, results: [] };
    }

    // Post-preflight: use provided results, clamping to last entry
    const postIdx = Math.min(idx - 1, postPreflightResults.length - 1);
    return postPreflightResults[postIdx]!;
  };

  return { runner, callCount: () => calls };
}
