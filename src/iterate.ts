import { buildClaudeArgs } from "./claude.ts";
import { ensureAuditDir, saveStageOutput } from "./audit.ts";
import { runAllGates } from "./gates.ts";
import { resolveGates } from "./resolve-gates.ts";
import { checkCharter } from "./charter.ts";
import { parseAssessment } from "./parse-assessment.ts";
import { triage as runTriage } from "./triage.ts";
import type {
  HoneConfig,
  IterationResult,
  ClaudeInvoker,
  GateDefinition,
  GatesRunResult,
  CharterCheckResult,
  StructuredAssessment,
  TriageResult,
  GateRunner,
  GateResolverFn,
  CharterCheckerFn,
  TriageRunnerFn,
} from "./types.ts";

export interface IterateOptions {
  agent: string;
  folder: string;
  config: HoneConfig;
  skipGates: boolean;
  skipCharter?: boolean;
  skipTriage?: boolean;
  gateRunner?: GateRunner;
  gateResolver?: GateResolverFn;
  charterChecker?: CharterCheckerFn;
  triageRunner?: TriageRunnerFn;
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

// --- Extracted stage functions ---

export async function runAssessStage(
  agent: string,
  folder: string,
  config: HoneConfig,
  claude: ClaudeInvoker,
): Promise<string> {
  const assessArgs = buildClaudeArgs({
    agent,
    model: config.models.assess,
    prompt: [
      `Assess the project in ${folder} against your principles.`,
      "Identify the principle that it is most violating,",
      "and describe how we should correct it.",
      "",
      "You MUST begin your response with a JSON block:",
      "```json",
      '{ "severity": <1-5>, "principle": "<name>", "category": "<category>" }',
      "```",
      "Then provide your full assessment below.",
      "",
      "Severity: 1=cosmetic, 2=minor, 3=moderate, 4=significant, 5=critical",
    ].join("\n"),
    readOnly: true,
    readOnlyTools: config.readOnlyTools,
  });
  return claude(assessArgs);
}

export async function runNameStage(
  agent: string,
  assessment: string,
  config: HoneConfig,
  claude: ClaudeInvoker,
): Promise<string> {
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
  return sanitizeName(rawName) || `assessment-${Date.now()}`;
}

export async function runPlanStage(
  agent: string,
  assessment: string,
  config: HoneConfig,
  claude: ClaudeInvoker,
): Promise<string> {
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
  return claude(planArgs);
}

export async function runExecuteWithVerify(
  agent: string,
  folder: string,
  assessment: string,
  plan: string,
  config: HoneConfig,
  claude: ClaudeInvoker,
  opts: {
    skipGates: boolean;
    gateRunner: (gates: GateDefinition[], projectDir: string, timeout: number) => Promise<GatesRunResult>;
    gateResolver: (projectDir: string, agentName: string, model: string, readOnlyTools: string, claude: ClaudeInvoker) => Promise<GateDefinition[]>;
    auditDir: string;
    name: string;
    onProgress: (stage: string, message: string) => void;
  },
): Promise<{
  execution: string;
  gatesResult: GatesRunResult | null;
  retries: number;
  success: boolean;
}> {
  const { skipGates, gateRunner, gateResolver, auditDir, name, onProgress } = opts;

  // Execute
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

  // Verify (inner loop)
  let gatesResult: GatesRunResult | null = null;
  let retries = 0;

  if (!skipGates) {
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
  return { execution, gatesResult, retries, success };
}

// --- Main iterate function ---

export async function iterate(
  opts: IterateOptions,
  claude: ClaudeInvoker,
): Promise<IterationResult> {
  const {
    agent,
    folder,
    config,
    skipGates,
    skipCharter = false,
    skipTriage = false,
    gateRunner = runAllGates,
    gateResolver = resolveGates,
    charterChecker = checkCharter,
    triageRunner = runTriage,
    onProgress,
  } = opts;

  // --- Charter check ---
  let charterCheckResult: CharterCheckResult | null = null;
  if (!skipCharter) {
    onProgress("charter", "Checking project charter clarity...");
    charterCheckResult = await charterChecker(folder, config.minCharterLength);
    if (!charterCheckResult.passed) {
      onProgress("charter", "Charter clarity insufficient.");
      for (const g of charterCheckResult.guidance) {
        onProgress("charter", `  → ${g}`);
      }
      return {
        name: "",
        assessment: "",
        plan: "",
        execution: "",
        gatesResult: null,
        retries: 0,
        success: false,
        structuredAssessment: null,
        triageResult: null,
        charterCheck: charterCheckResult,
        skippedReason: "Charter clarity insufficient",
      };
    }
    onProgress("charter", "Charter check passed.");
  }

  const auditDir = await ensureAuditDir(folder, config.auditDir);

  // --- Stage 1: Assess ---
  onProgress("assess", `Assessing ${folder} with ${agent}...`);
  const assessment = await runAssessStage(agent, folder, config, claude);
  const structuredAssessment = parseAssessment(assessment);

  // --- Stage 2: Name ---
  onProgress("name", "Generating filename...");
  const name = await runNameStage(agent, assessment, config, claude);

  // Save assessment
  const assessPath = await saveStageOutput(auditDir, name, "", assessment);
  onProgress("assess", `Saved: ${assessPath}`);

  // --- Stage 3: Triage ---
  let triageResult: TriageResult | null = null;
  if (!skipTriage) {
    onProgress("triage", "Running triage...");
    triageResult = await triageRunner(
      structuredAssessment,
      config.severityThreshold,
      config.models.triage,
      config.readOnlyTools,
      claude,
    );

    if (!triageResult.accepted) {
      onProgress("triage", `Triage rejected: ${triageResult.reason}`);
      return {
        name,
        assessment,
        plan: "",
        execution: "",
        gatesResult: null,
        retries: 0,
        success: true, // Not a failure — codebase is in good shape
        structuredAssessment,
        triageResult,
        charterCheck: charterCheckResult,
        skippedReason: `Triage: ${triageResult.reason}`,
      };
    }
    onProgress("triage", "Triage accepted.");
  }

  // --- Stage 4: Plan ---
  onProgress("plan", "Creating plan...");
  const plan = await runPlanStage(agent, assessment, config, claude);

  const planPath = await saveStageOutput(auditDir, name, "plan", plan);
  onProgress("plan", `Saved: ${planPath}`);

  // --- Stage 5: Execute + Verify ---
  const execResult = await runExecuteWithVerify(agent, folder, assessment, plan, config, claude, {
    skipGates,
    gateRunner,
    gateResolver,
    auditDir,
    name,
    onProgress,
  });

  onProgress(
    "done",
    execResult.success ? `Complete: ${name}` : `Incomplete: ${name} (gate failures remain)`,
  );

  return {
    name,
    assessment,
    plan,
    execution: execResult.execution,
    gatesResult: execResult.gatesResult,
    retries: execResult.retries,
    success: execResult.success,
    structuredAssessment,
    triageResult,
    charterCheck: charterCheckResult,
    skippedReason: null,
  };
}
