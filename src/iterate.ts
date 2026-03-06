import { buildClaudeArgs } from "./claude.ts";
import { ensureAuditDir, saveStageOutput } from "./audit.ts";
import { runAllGates } from "./gates.ts";
import { resolveGates } from "./resolve-gates.ts";
import { checkCharter } from "./charter.ts";
import { parseAssessment } from "./parse-assessment.ts";
import { triage as runTriage } from "./triage.ts";
import { runPreamble } from "./preamble.ts";
import { summarize as runSummarize, buildIterateSummarizePrompt } from "./summarize.ts";
import { verifyWithRetry } from "./verify-loop.ts";
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
  AttemptRecord,
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
  folder: string,
  plan: string,
  assessment: string,
  currentFailedGates: { name: string; output: string }[],
  priorAttempts: AttemptRecord[],
): string {
  const sections: string[] = [
    "## Goal",
    "",
    `Improve the project in ${folder}.`,
    "",
    "## Assessment",
    "",
    assessment,
    "",
    "## Original Plan",
    "",
    plan,
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
    "The previous execution introduced quality gate failures that must be fixed.",
    "Fix the failures below WITHOUT regressing on the original improvement.",
  );

  return sections.join("\n");
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
      "CRITICAL RULES:",
      "- Output the COMPLETE plan directly as text in your response. Do NOT summarize or abbreviate.",
      "- Do NOT create any files (PLAN.md, plan.md, or any other file). Your text output IS the plan.",
      "- Do NOT use the Write, Edit, or any file-creation tools. You have read-only access.",
      "- The entire plan must appear in your printed output — it will be captured and passed to the next stage for execution.",
      "- If any part of the plan is not in your output, it will be lost and the executor will not see it.",
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
    gates: GateDefinition[];
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
  const { skipGates, gateRunner, gates, auditDir, name, onProgress } = opts;

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
        buildRetryPrompt(folder, plan, assessment, failedGates, priorAttempts),
      onProgress,
    });
    gatesResult = verifyResult.gatesResult;
    retries = verifyResult.retries;
    execution = verifyResult.execution;
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

  // --- Run preamble (charter check + preflight gate validation) ---
  const preambleResult = await runPreamble({
    folder,
    agent,
    config,
    skipCharter,
    skipGates,
    gateResolver,
    gateRunner,
    charterChecker,
    claude,
    onProgress,
  });

  if (!preambleResult.passed) {
    return {
      name: "",
      assessment: "",
      plan: "",
      execution: "",
      gatesResult: preambleResult.gatesResult ?? null,
      retries: 0,
      success: false,
      structuredAssessment: null,
      triageResult: null,
      charterCheck: preambleResult.charterCheck,
      skippedReason: preambleResult.failureReason,
      headline: null,
      summary: null,
    };
  }

  const charterCheckResult = preambleResult.charterCheck;
  const preflightGates = preambleResult.gates;

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
        headline: null,
        summary: null,
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
    gates: preflightGates,
    auditDir,
    name,
    onProgress,
  });

  // --- Stage 6: Summarize (only on success) ---
  let headline: string | null = null;
  let summary: string | null = null;

  if (execResult.success) {
    try {
      onProgress("summarize", "Generating headline and summary...");
      const summarizePrompt = buildIterateSummarizePrompt({
        name,
        structuredAssessment,
        triageResult,
        execution: execResult.execution,
        retries: execResult.retries,
        gatesResult: execResult.gatesResult,
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
    headline,
    summary,
  };
}
