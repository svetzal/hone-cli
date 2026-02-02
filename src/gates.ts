import type { GateDefinition, GateResult, GatesRunResult } from "./types.ts";
import { runProcess } from "./process.ts";

export function truncateOutput(output: string, maxLines: number = 200): string {
  const lines = output.split("\n");
  if (lines.length <= maxLines) return output;
  return (
    `... (${lines.length - maxLines} lines truncated)\n` +
    lines.slice(-maxLines).join("\n")
  );
}

export async function runGate(
  gate: GateDefinition,
  projectDir: string,
  timeout: number,
): Promise<GateResult> {
  try {
    const { stdout, stderr, exitCode } = await runProcess(
      ["sh", "-c", gate.command],
      { cwd: projectDir, timeout },
    );

    const output = truncateOutput((stdout + "\n" + stderr).trim());

    return {
      name: gate.name,
      command: gate.command,
      passed: exitCode === 0,
      required: gate.required,
      output,
      exitCode,
    };
  } catch (err) {
    return {
      name: gate.name,
      command: gate.command,
      passed: false,
      required: gate.required,
      output: err instanceof Error ? err.message : String(err),
      exitCode: null,
    };
  }
}

export async function runAllGates(
  gates: GateDefinition[],
  projectDir: string,
  timeout: number,
): Promise<GatesRunResult> {
  if (gates.length === 0) {
    return { allPassed: true, requiredPassed: true, results: [] };
  }

  const results: GateResult[] = [];

  for (const gate of gates) {
    const result = await runGate(gate, projectDir, timeout);
    results.push(result);
  }

  const allPassed = results.every((r) => r.passed);
  const requiredPassed = results.filter((r) => r.required).every((r) => r.passed);

  return { allPassed, requiredPassed, results };
}
