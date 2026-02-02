import type { ClaudeInvoker } from "./types.ts";

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
