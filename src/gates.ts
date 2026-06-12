import { errorMessage } from "./errors.ts";
import { runProcess } from "./process.ts";
import type { GateDefinition, GateResult, GatesRunResult } from "./types.ts";

export function truncateOutput(output: string, maxLines: number = 200): string {
  const lines = output.split("\n");
  if (lines.length <= maxLines) return output;
  return `... (${lines.length - maxLines} lines truncated)\n${lines.slice(-maxLines).join("\n")}`;
}

interface CommandRun {
  passed: boolean;
  output: string;
  exitCode: number | null;
  timedOut: boolean;
}

async function runCommand(command: string, projectDir: string, timeout: number): Promise<CommandRun> {
  try {
    const { stdout, stderr, exitCode, timedOut } = await runProcess(["sh", "-c", command], {
      cwd: projectDir,
      timeout,
    });
    const rawOutput = `${stdout}\n${stderr}`.trim();
    const banner = timedOut
      ? `[GATE TIMED OUT after ${timeout}ms — process was killed; the command did NOT finish and the output below is partial]\n`
      : "";
    return {
      passed: exitCode === 0,
      output: truncateOutput(`${banner}${rawOutput}`),
      exitCode,
      timedOut,
    };
  } catch (err) {
    return { passed: false, output: errorMessage(err), exitCode: null, timedOut: false };
  }
}

/**
 * Run a single gate. When the gate fails and declares a `fix_command`, run the
 * fix once and re-check; a passing re-check resolves the gate (`fixApplied`),
 * leaving the repaired tree for the caller to commit. This lets formatter/lint
 * gates self-heal instead of deadlocking the loop.
 */
export async function runGate(gate: GateDefinition, projectDir: string, timeout: number): Promise<GateResult> {
  const effectiveTimeout = gate.timeout ?? timeout;
  const first = await runCommand(gate.command, projectDir, effectiveTimeout);

  let { passed, output, exitCode, timedOut } = first;
  let fixApplied = false;

  if (!passed && !timedOut && gate.fix_command) {
    const fix = await runCommand(gate.fix_command, projectDir, effectiveTimeout);
    if (fix.passed) {
      const recheck = await runCommand(gate.command, projectDir, effectiveTimeout);
      if (recheck.passed) {
        passed = true;
        fixApplied = true;
        ({ output, exitCode, timedOut } = recheck);
      } else {
        output = `${output}\n--- autofix attempted, gate still failing ---\n${recheck.output}`;
      }
    } else {
      output = `${output}\n--- autofix command failed ---\n${fix.output}`;
    }
  }

  return {
    name: gate.name,
    command: gate.command,
    passed,
    required: gate.required,
    output,
    exitCode,
    timedOut,
    ...(fixApplied && { fixApplied: true }),
  };
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
