import { ensureAuditDir, saveStageOutput } from "./audit.ts";
import { checkCharter } from "./charter.ts";
import { buildClaudeArgs } from "./claude.ts";
import { runExecuteWithVerify } from "./execute-with-verify.ts";
import { runAllGates } from "./gates.ts";
import { parseAssessment } from "./parse-assessment.ts";
import { runPreamble } from "./preamble.ts";
import { resolveGates } from "./resolve-gates.ts";
import { buildRetryPromptScaffold } from "./retry-formatting.ts";
import { buildIterateSummarizePrompt } from "./summarize.ts";
import { runSummarizeStage } from "./summarize-stage.ts";
import { triage as runTriage } from "./triage.ts";
import type {
  AttemptRecord,
  CharterCheckerFn,
  GateResolverFn,
  GateRunner,
  IterationResult,
  PipelineContext,
  TriageRunnerFn,
} from "./types.ts";

export interface IterateOptions {
  ctx: PipelineContext;
  skipGates: boolean;
  skipCharter?: boolean;
  skipTriage?: boolean;
  gateRunner?: GateRunner;
  gateResolver?: GateResolverFn;
  charterChecker?: CharterCheckerFn;
  triageRunner?: TriageRunnerFn;
}

export function sanitizeName(raw: string): string {
  const lower = raw.toLowerCase();
  // Prefer multi-segment kebab-case (e.g., "fix-auth-handler")
  const multiSegment = lower.match(/[a-z][a-z0-9]*(?:-[a-z0-9]+)+/g);
  if (multiSegment) {
    // biome-ignore lint/style/noNonNullAssertion: array is non-empty, guarded by the `if (multiSegment)` check above
    const longest = multiSegment.sort((a, b) => b.length - a.length)[0]!;
    return longest.slice(0, 50);
  }
  // Fall back to single lowercase word (minimum 2 chars)
  const single = lower.match(/[a-z][a-z0-9]+/g);
  if (single) {
    // biome-ignore lint/style/noNonNullAssertion: array is non-empty, guarded by the `if (single)` check above
    const longest = single.sort((a, b) => b.length - a.length)[0]!;
    return longest.slice(0, 50);
  }
  return "";
}

export function buildRetryPrompt(
  folder: string,
  plan: string,
  assessment: string,
  currentFailedGates: { name: string; output: string }[],
  priorAttempts: AttemptRecord[],
): string {
  return buildRetryPromptScaffold(
    [`Improve the project in ${folder}.`, "", "## Assessment", "", assessment, "", "## Original Plan", "", plan],
    [
      "The previous execution introduced quality gate failures that must be fixed.",
      "Fix the failures below WITHOUT regressing on the original improvement.",
    ],
    currentFailedGates,
    priorAttempts,
  );
}

// --- Extracted stage functions ---

export async function runAssessStage(ctx: PipelineContext): Promise<string> {
  const { agent, folder, config, claude } = ctx;
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

export async function runNameStage(ctx: PipelineContext, assessment: string): Promise<string> {
  const { agent, config, claude } = ctx;
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

export async function runPlanStage(ctx: PipelineContext, assessment: string): Promise<string> {
  const { agent, config, claude } = ctx;
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

// --- Main iterate function ---

export async function iterate(opts: IterateOptions): Promise<IterationResult> {
  const {
    ctx,
    skipGates,
    skipCharter = false,
    skipTriage = false,
    gateRunner = runAllGates,
    gateResolver = resolveGates,
    charterChecker = checkCharter,
    triageRunner = runTriage,
  } = opts;

  const { agent, folder, config, claude, onProgress } = ctx;

  // --- Run preamble (charter check + preflight gate validation) ---
  const preambleResult = await runPreamble({
    ctx,
    skipCharter,
    skipGates,
    gateResolver,
    gateRunner,
    charterChecker,
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
  const assessment = await runAssessStage(ctx);
  const structuredAssessment = parseAssessment(assessment);

  // --- Stage 2: Name ---
  onProgress("name", "Generating filename...");
  const name = await runNameStage(ctx, assessment);

  // Save assessment
  const assessPath = await saveStageOutput(auditDir, name, "", assessment);
  onProgress("assess", `Saved: ${assessPath}`);

  // --- Stage 3: Triage ---
  let triageResult = null;
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
  const plan = await runPlanStage(ctx, assessment);

  const planPath = await saveStageOutput(auditDir, name, "plan", plan);
  onProgress("plan", `Saved: ${planPath}`);

  // --- Stage 5: Execute + Verify ---
  const executePrompt = [
    `Execute the following plan to improve the project in ${folder}.`,
    "",
    "Why:",
    assessment,
    "",
    "Plan:",
    plan,
  ].join("\n");

  const execResult = await runExecuteWithVerify(ctx, executePrompt, {
    skipGates,
    gateRunner,
    gates: preflightGates,
    auditDir,
    name,
    buildRetryPrompt: (failedGates, priorAttempts) =>
      buildRetryPrompt(folder, plan, assessment, failedGates, priorAttempts),
  });

  // --- Stage 6: Summarize (only on success) ---
  let headline: string | null = null;
  let summary: string | null = null;

  if (execResult.success) {
    const summarizeResult = await runSummarizeStage(
      () =>
        buildIterateSummarizePrompt({
          name,
          structuredAssessment,
          triageResult,
          execution: execResult.execution,
          retries: execResult.retries,
          gatesResult: execResult.gatesResult,
        }),
      ctx,
    );
    headline = summarizeResult.headline;
    summary = summarizeResult.summary;
  }

  onProgress("done", execResult.success ? `Complete: ${name}` : `Incomplete: ${name} (gate failures remain)`);

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
