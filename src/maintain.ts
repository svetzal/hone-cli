import { ensureAuditDir } from "./audit.ts";
import { runAllGates } from "./gates.ts";
import { resolveGates } from "./resolve-gates.ts";
import { buildMaintainSummarizePrompt } from "./summarize.ts";
import { buildRetryPromptScaffold } from "./retry-formatting.ts";
import { runSummarizeStage } from "./summarize-stage.ts";
import { runExecuteWithVerify } from "./execute-with-verify.ts";
import type {
  HoneConfig,
  MaintainResult,
  ClaudeInvoker,
  GateDefinition,
  GatesRunResult,
  GateRunner,
  GateResolverFn,
  AttemptRecord,
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
  folder: string,
  gates: GateDefinition[],
  currentFailedGates: { name: string; output: string }[],
  priorAttempts: AttemptRecord[],
): string {
  const gateList = gates
    .map((g) => `- ${g.name}: \`${g.command}\`${g.required ? "" : " (optional)"}`)
    .join("\n");

  return buildRetryPromptScaffold(
    [
      `Update the project dependencies in ${folder} to their latest compatible versions.`,
      "",
      "Quality gates:",
      gateList,
    ],
    [
      "The dependency updates introduced quality gate failures that must be fixed.",
      "Fix the failures below without reverting the dependency updates unless absolutely necessary.",
    ],
    currentFailedGates,
    priorAttempts,
  );
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
      headline: null,
      summary: null,
    };
  }

  onProgress("gates", `Found ${gates.length} gate(s).`);

  const name = `maintain-${formatTimestamp()}`;
  const auditDir = await ensureAuditDir(folder, config.auditDir);

  const prompt = buildMaintainPrompt(folder, gates);
  const execResult = await runExecuteWithVerify(agent, prompt, config, claude, {
    skipGates: false,
    gateRunner,
    gates,
    auditDir,
    name,
    folder,
    buildRetryPrompt: (failedGates, priorAttempts) =>
      buildMaintainRetryPrompt(folder, gates, failedGates, priorAttempts),
    onProgress,
  });

  const { execution, gatesResult, retries } = execResult;
  const success = gatesResult?.requiredPassed ?? false;

  // Summarize (only on success)
  let headline: string | null = null;
  let summary: string | null = null;

  if (success) {
    const summarizeResult = await runSummarizeStage(
      () => buildMaintainSummarizePrompt({ name, execution, retries, gatesResult }),
      config,
      claude,
      onProgress,
    );
    headline = summarizeResult.headline;
    summary = summarizeResult.summary;
  }

  return { name, execution, gatesResult, retries, success, headline, summary };
}
