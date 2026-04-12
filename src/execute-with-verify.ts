import { saveStageOutput } from "./audit.ts";
import { buildClaudeArgs } from "./claude.ts";
import type { AttemptRecord, GateDefinition, GatesRunResult, PipelineContext } from "./types.ts";
import { verifyWithRetry } from "./verify-loop.ts";

export async function runExecuteWithVerify(
  ctx: PipelineContext,
  prompt: string,
  opts: {
    skipGates: boolean;
    gateRunner: (gates: GateDefinition[], projectDir: string, timeout: number) => Promise<GatesRunResult>;
    gates: GateDefinition[];
    auditDir: string;
    name: string;
    buildRetryPrompt: (failedGates: { name: string; output: string }[], priorAttempts: AttemptRecord[]) => string;
  },
): Promise<{
  execution: string;
  gatesResult: GatesRunResult | null;
  retries: number;
  success: boolean;
}> {
  const { agent, config, claude, onProgress } = ctx;
  const { skipGates, gateRunner, gates, auditDir, name, buildRetryPrompt: buildRetryPromptFn } = opts;

  onProgress("execute", "Executing plan...");
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

  let gatesResult: GatesRunResult | null = null;
  let retries = 0;

  if (!skipGates) {
    const verifyResult = await verifyWithRetry(execution, {
      ctx,
      gates,
      gateRunner,
      maxRetries: config.maxRetries,
      gateTimeout: config.gateTimeout,
      auditDir,
      name,
      buildRetryPrompt: buildRetryPromptFn,
    });
    gatesResult = verifyResult.gatesResult;
    retries = verifyResult.retries;
    execution = verifyResult.execution;
  }

  const success = skipGates || (gatesResult?.requiredPassed ?? true);
  return { execution, gatesResult, retries, success };
}
