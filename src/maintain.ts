import { buildClaudeArgs } from "./claude.ts";
import { ensureAuditDir, saveStageOutput } from "./audit.ts";
import { runAllGates } from "./gates.ts";
import { resolveGates } from "./resolve-gates.ts";
import type {
  HoneConfig,
  MaintainResult,
  ClaudeInvoker,
  GateDefinition,
  GatesRunResult,
  GateRunner,
  GateResolverFn,
} from "./types.ts";

export interface MaintainOptions {
  agent: string;
  folder: string;
  config: HoneConfig;
  gateRunner?: GateRunner;
  gateResolver?: GateResolverFn;
  onProgress: (stage: string, message: string) => void;
}

export function buildMaintainPrompt(folder: string, gates: GateDefinition[]): string {
  const gateList = gates
    .map((g) => `- ${g.name}: \`${g.command}\`${g.required ? "" : " (optional)"}`)
    .join("\n");

  return [
    `Update the project dependencies in ${folder} to their latest compatible versions.`,
    "",
    "Guidelines:",
    "- Prefer minor and patch updates over major version bumps",
    "- Update one ecosystem at a time (e.g. npm packages, then tooling)",
    "- If a major update is available, only apply it if the changelog shows no breaking changes affecting this project",
    "- Run the project's quality gates after updating to verify nothing breaks",
    "",
    "The project has these quality gates configured:",
    gateList,
  ].join("\n");
}

export function buildMaintainRetryPrompt(
  failedResults: { name: string; output: string }[],
): string {
  const failures = failedResults
    .map((r) => `### Gate: ${r.name}\n\n${r.output}`)
    .join("\n\n");

  return [
    "The dependency updates introduced quality gate failures that must be fixed.",
    "Fix the failures below without reverting the dependency updates unless absolutely necessary.",
    "",
    "## Failed Gates",
    failures,
  ].join("\n");
}

function formatTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    now.getFullYear(),
    "-",
    pad(now.getMonth() + 1),
    "-",
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
}

export async function maintain(
  opts: MaintainOptions,
  claude: ClaudeInvoker,
): Promise<MaintainResult> {
  const {
    agent,
    folder,
    config,
    gateRunner = runAllGates,
    gateResolver = resolveGates,
    onProgress,
  } = opts;

  // Resolve gates
  onProgress("gates", "Resolving quality gates...");
  const gates = await gateResolver(
    folder,
    agent,
    config.models.gates,
    config.readOnlyTools,
    claude,
  );

  if (gates.length === 0) {
    onProgress("gates", "No quality gates found. Cannot run maintain without gates.");
    return {
      name: "",
      execution: "",
      gatesResult: null,
      retries: 0,
      success: false,
    };
  }

  onProgress("gates", `Found ${gates.length} gate(s).`);

  const name = `maintain-${formatTimestamp()}`;
  const auditDir = await ensureAuditDir(folder, config.auditDir);

  // Execute
  onProgress("execute", "Updating dependencies...");
  const prompt = buildMaintainPrompt(folder, gates);
  const executeArgs = buildClaudeArgs({
    agent,
    model: config.models.execute,
    prompt,
    readOnly: false,
    readOnlyTools: config.readOnlyTools,
  });
  let execution = await claude(executeArgs);

  const actionsPath = await saveStageOutput(auditDir, name, "actions", execution);
  onProgress("execute", `Saved: ${actionsPath}`);

  // Verify (inner loop)
  let gatesResult: GatesRunResult | null = null;
  let retries = 0;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    onProgress("verify", `Running quality gates (attempt ${attempt + 1})...`);
    gatesResult = await gateRunner(gates, folder, config.gateTimeout);

    if (gatesResult.requiredPassed) {
      onProgress("verify", "All required gates passed.");
      break;
    }

    if (attempt === config.maxRetries) {
      onProgress("verify", `Required gates still failing after ${config.maxRetries} retries.`);
      break;
    }

    const failedGates = gatesResult.results
      .filter((r) => !r.passed && r.required)
      .map((r) => ({ name: r.name, output: r.output }));

    const retryPrompt = buildMaintainRetryPrompt(failedGates);
    retries = attempt + 1;

    onProgress("execute", `Retry ${retries}: fixing gate failures...`);
    const retryArgs = buildClaudeArgs({
      agent,
      model: config.models.execute,
      prompt: retryPrompt,
      readOnly: false,
      readOnlyTools: config.readOnlyTools,
    });
    execution = await claude(retryArgs);

    const retryPath = await saveStageOutput(auditDir, name, `retry-${retries}-actions`, execution);
    onProgress("execute", `Saved: ${retryPath}`);
  }

  const success = gatesResult?.requiredPassed ?? false;
  return { name, execution, gatesResult, retries, success };
}
