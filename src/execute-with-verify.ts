import { saveStageOutput } from "./audit.ts";
import { claudeCtx, invokeWriteStage } from "./claude.ts";
import type { GateDefinition, GateRunner, GatesRunResult, PipelineContext } from "./types.ts";
import type { RetryPromptBuilder } from "./verify-loop.ts";
import { verifyWithRetry } from "./verify-loop.ts";

export async function runExecuteWithVerify(
  ctx: PipelineContext,
  prompt: string,
  opts: {
    skipGates: boolean;
    gateRunner: GateRunner;
    gates: GateDefinition[];
    auditDir: string;
    name: string;
    buildRetryPrompt: RetryPromptBuilder;
  },
): Promise<{
  execution: string;
  gatesResult: GatesRunResult | null;
  retries: number;
  success: boolean;
}> {
  const { agent, onProgress } = ctx;
  const { skipGates, gateRunner, gates, auditDir, name, buildRetryPrompt: buildRetryPromptFn } = opts;

  onProgress("execute", "Executing plan...");
  let execution = await invokeWriteStage(claudeCtx(ctx, "execute"), prompt, { agent });

  const actionsPath = await saveStageOutput(auditDir, name, "actions", execution);
  onProgress("execute", `Saved: ${actionsPath}`);

  let gatesResult: GatesRunResult | null = null;
  let retries = 0;

  if (!skipGates) {
    const verifyResult = await verifyWithRetry(execution, {
      ctx,
      gates,
      gateRunner,
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
