import { buildClaudeArgs } from "./claude.ts";
import { ensureAuditDir, saveStageOutput } from "./audit.ts";
import { runAllGates } from "./gates.ts";
import { resolveGates } from "./resolve-gates.ts";
import { summarize as runSummarize, buildMaintainSummarizePrompt } from "./summarize.ts";
import { verifyWithRetry } from "./verify-loop.ts";
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

  const sections: string[] = [
    "## Goal",
    "",
    `Update the project dependencies in ${folder} to their latest compatible versions.`,
    "",
    "Quality gates:",
    gateList,
  ];

  for (const prior of priorAttempts) {
    const priorFailures = prior.failedGates
      .map((r) => `### Gate: ${r.name}\n\n${r.output}`)
      .join("\n\n");

    sections.push(
      "",
      `## Attempt ${prior.attempt}`,
      "",
      priorFailures,
    );
  }

  const currentFailures = currentFailedGates
    .map((r) => `### Gate: ${r.name}\n\n${r.output}`)
    .join("\n\n");

  sections.push(
    "",
    "## Current Failed Gates",
    "",
    currentFailures,
    "",
    "## Task",
    "",
    "The dependency updates introduced quality gate failures that must be fixed.",
    "Fix the failures below without reverting the dependency updates unless absolutely necessary.",
  );

  return sections.join("\n");
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
    buildRetryPrompt: (failedGates, priorAttempts) =>
      buildMaintainRetryPrompt(folder, gates, failedGates, priorAttempts),
    onProgress,
  });

  const { gatesResult, retries } = verifyResult;
  execution = verifyResult.execution;
  const success = gatesResult?.requiredPassed ?? false;

  // Summarize (only on success)
  let headline: string | null = null;
  let summary: string | null = null;

  if (success) {
    try {
      onProgress("summarize", "Generating headline and summary...");
      const summarizePrompt = buildMaintainSummarizePrompt({
        name,
        execution,
        retries,
        gatesResult,
      });
      const summarizeResult = await runSummarize(
        summarizePrompt,
        config.models.summarize,
        config.readOnlyTools,
        claude,
      );
      if (summarizeResult) {
        headline = summarizeResult.headline;
        summary = summarizeResult.summary;
      }
    } catch {
      // Summarize is cosmetic — never block the pipeline
    }
  }

  return { name, execution, gatesResult, retries, success, headline, summary };
}
