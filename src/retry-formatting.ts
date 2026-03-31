import type { AttemptRecord } from "./types.ts";

/**
 * Format an array of gate failures into markdown sections.
 * Single source of truth for how gate failures appear in retry prompts.
 */
export function formatGateFailures(
  gates: { name: string; output: string }[],
): string {
  return gates
    .map((r) => `### Gate: ${r.name}\n\n${r.output}`)
    .join("\n\n");
}

/**
 * Append prior attempt history and current failed gates to a retry prompt sections array.
 * Mutates the provided sections array in place (consistent with how both callers use it).
 */
export function appendRetryHistory(
  sections: string[],
  priorAttempts: AttemptRecord[],
  currentFailedGates: { name: string; output: string }[],
): void {
  for (const prior of priorAttempts) {
    sections.push(
      "",
      `## Attempt ${prior.attempt}`,
      "",
      formatGateFailures(prior.failedGates),
    );
  }

  sections.push(
    "",
    "## Current Failed Gates",
    "",
    formatGateFailures(currentFailedGates),
  );
}

/**
 * Shared scaffold for building retry prompts.
 * Assembles: ## Goal → goalLines → retry history → ## Task → taskLines
 */
export function buildRetryPromptScaffold(
  goalLines: string[],
  taskLines: string[],
  currentFailedGates: { name: string; output: string }[],
  priorAttempts: AttemptRecord[],
): string {
  const sections: string[] = ["## Goal", "", ...goalLines];

  appendRetryHistory(sections, priorAttempts, currentFailedGates);

  sections.push("", "## Task", "", ...taskLines);

  return sections.join("\n");
}
