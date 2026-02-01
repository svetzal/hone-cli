import { join } from "path";
import type { GateDefinition, GateResult, GatesRunResult } from "./types.ts";

interface MarkerGates {
  marker: string;
  gates: GateDefinition[];
}

const AUTO_DETECT_RULES: MarkerGates[] = [
  {
    marker: "package.json",
    gates: [
      { name: "test", command: "npm test", required: true },
      { name: "lint", command: "npm run lint", required: true },
      { name: "security", command: "npm audit --audit-level=moderate", required: false },
    ],
  },
  {
    marker: "mix.exs",
    gates: [
      { name: "test", command: "mix test", required: true },
      { name: "lint", command: "mix credo --strict && mix format --check-formatted", required: true },
      { name: "security", command: "mix deps.audit && mix hex.audit && mix sobelow --config", required: false },
    ],
  },
  {
    marker: "pyproject.toml",
    gates: [
      { name: "test", command: "pytest", required: true },
      { name: "lint", command: "ruff check src && ruff format --check src", required: true },
      { name: "security", command: "pip-audit", required: false },
    ],
  },
  {
    marker: "CMakeLists.txt",
    gates: [
      { name: "test", command: "ctest --output-on-failure", required: true },
      { name: "lint", command: "cppcheck --enable=all --error-exitcode=1 src/", required: true },
    ],
  },
];

export async function detectGates(projectDir: string): Promise<GateDefinition[]> {
  // Check for override file first
  const overridePath = join(projectDir, ".hone-gates.json");
  const overrideFile = Bun.file(overridePath);

  if (await overrideFile.exists()) {
    const config = await overrideFile.json();
    return (config.gates as GateDefinition[]).map((g) => ({
      name: g.name,
      command: g.command,
      required: g.required ?? true,
    }));
  }

  // Auto-detect by marker files
  for (const rule of AUTO_DETECT_RULES) {
    const markerFile = Bun.file(join(projectDir, rule.marker));
    if (await markerFile.exists()) {
      return rule.gates;
    }
  }

  return [];
}

function truncateOutput(output: string, maxLines: number = 200): string {
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
    const proc = Bun.spawn(["sh", "-c", gate.command], {
      cwd: projectDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const timeoutId = setTimeout(() => proc.kill(), timeout);

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    clearTimeout(timeoutId);

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
  projectDir: string,
  timeout: number,
): Promise<GatesRunResult> {
  const gates = await detectGates(projectDir);

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
