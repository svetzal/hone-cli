import { buildClaudeArgs } from "./claude.ts";
import { saveStageOutput } from "./audit.ts";
import { verifyWithRetry } from "./verify-loop.ts";
import type {
  HoneConfig,
  ClaudeInvoker,
  GateDefinition,
  GatesRunResult,
  AttemptRecord,
} from "./types.ts";

export async function runExecuteWithVerify(
  agent: string,
  prompt: string,
  config: HoneConfig,
  claude: ClaudeInvoker,
  opts: {
    skipGates: boolean;
    gateRunner: (gates: GateDefinition[], projectDir: string, timeout: number) => Promise<GatesRunResult>;
    gates: GateDefinition[];
    auditDir: string;
    name: string;
    folder: string;
    buildRetryPrompt: (failedGates: { name: string; output: string }[], priorAttempts: AttemptRecord[]) => string;
    onProgress: (stage: string, message: string) => void;
  },
): Promise<{
  execution: string;
  gatesResult: GatesRunResult | null;
  retries: number;
  success: boolean;
}> {
  const { skipGates, gateRunner, gates, auditDir, name, folder, buildRetryPrompt: buildRetryPromptFn, onProgress } = opts;

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
      gates,
      gateRunner,
      maxRetries: config.maxRetries,
      gateTimeout: config.gateTimeout,
      executeModel: config.models.execute,
      readOnlyTools: config.readOnlyTools,
      agent,
      folder,
      auditDir,
      name,
      claude,
      buildRetryPrompt: buildRetryPromptFn,
      onProgress,
    });
    gatesResult = verifyResult.gatesResult;
    retries = verifyResult.retries;
    execution = verifyResult.execution;
  }

  const success = skipGates || (gatesResult?.requiredPassed ?? true);
  return { execution, gatesResult, retries, success };
}
