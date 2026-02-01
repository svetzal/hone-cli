import { buildClaudeArgs } from "./claude.ts";
import { ensureAuditDir, saveStageOutput } from "./audit.ts";
import { runAllGates } from "./gates.ts";
import { resolveGates } from "./resolve-gates.ts";
import type { HoneConfig, IterationResult, ClaudeInvoker, GateDefinition, GatesRunResult } from "./types.ts";

export interface IterateOptions {
  agent: string;
  folder: string;
  config: HoneConfig;
  skipGates: boolean;
  gateRunner?: (gates: GateDefinition[], projectDir: string, timeout: number) => Promise<GatesRunResult>;
  gateResolver?: (projectDir: string, agentName: string, model: string, readOnlyTools: string, claude: ClaudeInvoker) => Promise<GateDefinition[]>;
  onProgress: (stage: string, message: string) => void;
}

export function sanitizeName(raw: string): string {
  const match = raw.match(/[a-z0-9-]+/);
  if (!match) return "";
  return match[0]!.slice(0, 50);
}

export function buildRetryPrompt(
  plan: string,
  failedResults: { name: string; output: string }[],
): string {
  const failures = failedResults
    .map((r) => `### Gate: ${r.name}\n\n${r.output}`)
    .join("\n\n");

  return [
    "The previous execution introduced quality gate failures that must be fixed.",
    "Fix the failures below WITHOUT regressing on the original improvement.",
    "",
    "## Original Plan",
    plan,
    "",
    "## Failed Gates",
    failures,
  ].join("\n");
}

export async function iterate(
  opts: IterateOptions,
  claude: ClaudeInvoker,
): Promise<IterationResult> {
  const {
    agent,
    folder,
    config,
    skipGates,
    gateRunner = runAllGates,
    gateResolver = resolveGates,
    onProgress,
  } = opts;
  const auditDir = await ensureAuditDir(folder, config.auditDir);

  // --- Stage 1: Assess ---
  onProgress("assess", `Assessing ${folder} with ${agent}...`);
  const assessArgs = buildClaudeArgs({
    agent,
    model: config.models.assess,
    prompt: [
      `Assess the project in ${folder} against your principles.`,
      "Identify the principle that it is most violating,",
      "and describe how we should correct it.",
    ].join(" "),
    readOnly: true,
    readOnlyTools: config.readOnlyTools,
  });
  const assessment = await claude(assessArgs);

  // --- Stage 2: Name ---
  onProgress("name", "Generating filename...");
  const nameArgs = buildClaudeArgs({
    agent,
    model: config.models.name,
    prompt: [
      "Output ONLY a short kebab-case filename (no extension) summarizing the main issue.",
      "Rules: lowercase, hyphens only, no spaces, no backticks, no explanation, max 50 chars.",
      "Example: fix-duplicate-api-helpers",
      "",
      "Assessment:",
      assessment,
    ].join("\n"),
    readOnly: true,
    readOnlyTools: config.readOnlyTools,
  });
  const rawName = await claude(nameArgs);
  const name = sanitizeName(rawName) || `assessment-${Date.now()}`;

  // Save assessment
  const assessPath = await saveStageOutput(auditDir, name, "", assessment);
  onProgress("assess", `Saved: ${assessPath}`);

  // --- Stage 3: Plan ---
  onProgress("plan", "Creating plan...");
  const planArgs = buildClaudeArgs({
    agent,
    model: config.models.plan,
    prompt: [
      "Based on the following assessment, create a step-by-step plan to address the issues identified.",
      "Make sure each step is clear and actionable.",
      "",
      "IMPORTANT: Output the COMPLETE plan in full detail. Do not summarize or abbreviate.",
      "The entire plan text will be passed to the next stage for execution.",
      "",
      "Assessment:",
      assessment,
    ].join("\n"),
    readOnly: true,
    readOnlyTools: config.readOnlyTools,
  });
  const plan = await claude(planArgs);

  const planPath = await saveStageOutput(auditDir, name, "plan", plan);
  onProgress("plan", `Saved: ${planPath}`);

  // --- Stage 4: Execute ---
  onProgress("execute", "Executing plan...");
  const executeArgs = buildClaudeArgs({
    agent,
    model: config.models.execute,
    prompt: [
      `Execute the following plan to improve the project in ${folder}.`,
      "",
      "Why:",
      assessment,
      "",
      "Plan:",
      plan,
    ].join("\n"),
    readOnly: false,
    readOnlyTools: config.readOnlyTools,
  });
  let execution = await claude(executeArgs);

  const actionsPath = await saveStageOutput(auditDir, name, "actions", execution);
  onProgress("execute", `Saved: ${actionsPath}`);

  // --- Stage 5: Verify (inner loop) ---
  let gatesResult = null;
  let retries = 0;

  if (!skipGates) {
    // Resolve gates once before the verify loop
    onProgress("verify", "Resolving quality gates...");
    const gates = await gateResolver(folder, agent, config.models.gates, config.readOnlyTools, claude);

    if (gates.length === 0) {
      onProgress("verify", "No quality gates found.");
    }

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

      // Build retry prompt with failure context
      const failedGates = gatesResult.results
        .filter((r) => !r.passed && r.required)
        .map((r) => ({ name: r.name, output: r.output }));

      const retryPrompt = buildRetryPrompt(plan, failedGates);
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
  }

  const success = skipGates || (gatesResult?.requiredPassed ?? true);

  onProgress("done", success ? `Complete: ${name}` : `Incomplete: ${name} (gate failures remain)`);

  return {
    name,
    assessment,
    plan,
    execution,
    gatesResult,
    retries,
    success,
  };
}
