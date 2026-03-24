/**
 * Output utilities for handling --json flag consistently across commands
 */
import type { GateResult } from "./types.ts";

/**
 * Write structured data as JSON to stdout
 * Used when --json flag is active
 */
export function writeJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

/**
 * Write progress/status messages to appropriate stream
 * - Normal mode: stdout (human-readable)
 * - JSON mode: stderr (keeps stdout clean for JSON data)
 */
export function progress(json: boolean, message: string): void {
  if (!json) {
    console.log(message);
  } else {
    console.error(message);
  }
}

export type ProgressCallback = (stage: string, message: string) => void;

/**
 * Create a progress callback that writes stage-prefixed messages to the
 * appropriate stream based on --json mode.
 * - Normal mode: stdout
 * - JSON mode: stderr (keeps stdout clean for JSON data)
 */
export function createProgressCallback(isJson: boolean): ProgressCallback {
  return (stage: string, message: string) => {
    if (isJson) {
      console.error(`==> [${stage}] ${message}`);
    } else {
      console.log(`==> [${stage}] ${message}`);
    }
  };
}

/**
 * Report gate validation results to the appropriate stream.
 * Prints pass/fail status for each gate and a warning when any gate fails.
 */
export function reportGateValidation(
  results: GateResult[],
  allPassed: boolean,
  isJson: boolean,
): void {
  for (const r of results) {
    const status = r.passed ? "pass" : "FAIL";
    progress(isJson, `  ${status}: ${r.name} (${r.command})`);
  }

  if (!allPassed) {
    progress(isJson, "Some gates failed. Review and fix before running hone iterate.");
  }
}
