import { buildClaudeArgs } from "./claude.ts";
import { saveStageOutput } from "./audit.ts";
import { loadOverrideGates } from "./resolve-gates.ts";
import type {
  GateDefinition,
  GatesRunResult,
  ClaudeInvoker,
  GateRunner,
  AttemptRecord,
} from "./types.ts";

export type RetryPromptBuilder = (
  failedGates: { name: string; output: string }[],
  priorAttempts: AttemptRecord[],
) => string;

export interface VerifyWithRetryOpts {
  gates: GateDefinition[];
  gateRunner: GateRunner;
  maxRetries: number;
  gateTimeout: number;
  executeModel: string;
  readOnlyTools: string;
  agent: string;
  folder: string;
  auditDir: string;
  name: string;
  claude: ClaudeInvoker;
  buildRetryPrompt: RetryPromptBuilder;
  onProgress: (stage: string, message: string) => void;
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
  const {
    gates, gateRunner, maxRetries, gateTimeout, executeModel, readOnlyTools,
    agent, folder, auditDir, name, claude, buildRetryPrompt, onProgress,
  } = opts;

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
