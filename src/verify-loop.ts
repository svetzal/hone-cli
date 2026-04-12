import { saveStageOutput } from "./audit.ts";
import { buildClaudeArgs } from "./claude.ts";
import { loadOverrideGates } from "./resolve-gates.ts";
import type { AttemptRecord, GateDefinition, GateRunner, GatesRunResult, PipelineContext } from "./types.ts";

export type RetryPromptBuilder = (
  failedGates: { name: string; output: string }[],
  priorAttempts: AttemptRecord[],
) => string;

export interface VerifyWithRetryOpts {
  ctx: PipelineContext;
  gates: GateDefinition[];
  gateRunner: GateRunner;
  maxRetries: number;
  gateTimeout: number;
  auditDir: string;
  name: string;
  buildRetryPrompt: RetryPromptBuilder;
}

export interface VerifyWithRetryResult {
  gatesResult: GatesRunResult | null;
  retries: number;
  execution: string;
}

export async function verifyWithRetry(
  initialExecution: string,
  opts: VerifyWithRetryOpts,
): Promise<VerifyWithRetryResult> {
  const { ctx, gates, gateRunner, maxRetries, gateTimeout, auditDir, name, buildRetryPrompt } = opts;
  const { agent, folder, claude, onProgress, config } = ctx;
  const executeModel = config.models.execute;
  const readOnlyTools = config.readOnlyTools;

  let execution = initialExecution;
  let gatesResult: GatesRunResult | null = null;
  let retries = 0;
  const attempts: AttemptRecord[] = [];

  if (gates.length === 0) {
    onProgress("verify", "No quality gates found.");
  }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Re-read .hone-gates.json in case the agent updated gate definitions
    const currentGates = (await loadOverrideGates(folder)) ?? gates;
    onProgress("verify", `Running quality gates (attempt ${attempt + 1})...`);
    gatesResult = await gateRunner(currentGates, folder, gateTimeout);

    if (gatesResult.requiredPassed) {
      onProgress("verify", "All required gates passed.");
      break;
    }

    if (attempt === maxRetries) {
      onProgress("verify", `Required gates still failing after ${maxRetries} retries.`);
      break;
    }

    const failedGates = gatesResult.results
      .filter((r) => !r.passed && r.required)
      .map((r) => ({ name: r.name, output: r.output }));

    const retryPrompt = buildRetryPrompt(failedGates, [...attempts]);
    retries = attempt + 1;

    attempts.push({ attempt: retries, failedGates });

    onProgress("execute", `Retry ${retries}: fixing gate failures...`);
    const retryArgs = buildClaudeArgs({
      agent,
      model: executeModel,
      prompt: retryPrompt,
      readOnly: false,
      readOnlyTools,
    });
    execution = await claude(retryArgs);

    const retryPath = await saveStageOutput(auditDir, name, `retry-${retries}-actions`, execution);
    onProgress("execute", `Saved: ${retryPath}`);
  }

  return { gatesResult, retries, execution };
}
