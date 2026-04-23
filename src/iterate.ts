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
  CharterCheckResult,
  GateResolverFn,
  GateRunner,
  GatesRunResult,
  IterationCompleted,
  IterationResult,
  IterationSkipped,
  PipelineContext,
  StructuredAssessment,
  TriageResult,
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

export function buildExecutePrompt(folder: string, assessment: string, plan: string): string {
  return [
    `Execute the following plan to improve the project in ${folder}.`,
    "",
    "Why:",
    assessment,
    "",
    "Plan:",
    plan,
  ].join("\n");
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

// --- Shared pipeline types ---

export type ProposalPipelineOutcome =
  | {
      rejected: false;
      name: string;
      assessment: string;
      structuredAssessment: StructuredAssessment | null;
      triageResult: TriageResult | null;
    }
  | {
      rejected: true;
      reason: string;
      name: string;
      assessment: string;
      structuredAssessment: StructuredAssessment | null;
      triageResult: TriageResult | null;
    };

export interface ProposalProgress {
  onAssess(msg: string): void;
  onAssessSaved(path: string): void;
  onName(msg: string): void;
  onTriageStart(): void;
  onTriageAccepted(): void;
  onTriageRejected(reason: string): void;
}

// --- Shared proposal pipeline orchestrator ---

export async function runProposalPipeline(
  ctx: PipelineContext,
  auditDir: string,
  opts: { skipTriage: boolean; triageRunner: TriageRunnerFn; progress: ProposalProgress },
): Promise<ProposalPipelineOutcome> {
  const { config, claude } = ctx;
  const { skipTriage, triageRunner, progress } = opts;

  // Stage: Assess
  progress.onAssess(`Assessing ${ctx.folder} with ${ctx.agent}...`);
  const assessment = await runAssessStage(ctx);
  const structuredAssessment = parseAssessment(assessment);

  // Stage: Name
  progress.onName("Generating filename...");
  const name = await runNameStage(ctx, assessment);

  const assessPath = await saveStageOutput(auditDir, name, "", assessment);
  progress.onAssessSaved(assessPath);

  // Stage: Triage
  if (!skipTriage) {
    progress.onTriageStart();
    const triageResult = await triageRunner(structuredAssessment, config.severityThreshold, {
      model: config.models.triage,
      readOnlyTools: config.readOnlyTools,
      claude,
    });

    if (!triageResult.accepted) {
      progress.onTriageRejected(triageResult.reason);
      return { rejected: true, reason: triageResult.reason, name, assessment, structuredAssessment, triageResult };
    }
    progress.onTriageAccepted();
    return { rejected: false, name, assessment, structuredAssessment, triageResult };
  }

  return { rejected: false, name, assessment, structuredAssessment, triageResult: null };
}

// --- Private result builders ---

function buildSkippedResult(fields: {
  skippedReason: string;
  success?: boolean;
  name?: string;
  assessment?: string;
  gatesResult?: GatesRunResult | null;
  charterCheck?: CharterCheckResult | null;
  structuredAssessment?: StructuredAssessment | null;
  triageResult?: TriageResult | null;
}): IterationSkipped {
  return {
    kind: "skipped",
    skippedReason: fields.skippedReason,
    success: fields.success ?? false,
    name: fields.name ?? "",
    assessment: fields.assessment ?? "",
    gatesResult: fields.gatesResult ?? null,
    charterCheck: fields.charterCheck ?? null,
    structuredAssessment: fields.structuredAssessment ?? null,
    triageResult: fields.triageResult ?? null,
  };
}

function buildCompletedResult(fields: Omit<IterationCompleted, "kind">): IterationCompleted {
  return { kind: "completed", ...fields };
}

// --- Private pipeline stage: assess + name + triage ---

type AssessAndTriageSuccess = {
  rejected: false;
  name: string;
  assessment: string;
  structuredAssessment: StructuredAssessment | null;
  triageResult: TriageResult | null;
};

type AssessAndTriageRejected = {
  rejected: true;
  result: IterationSkipped;
};

async function runAssessAndTriage(
  ctx: PipelineContext,
  auditDir: string,
  charterCheck: CharterCheckResult | null,
  skipTriage: boolean,
  triageRunner: TriageRunnerFn,
): Promise<AssessAndTriageSuccess | AssessAndTriageRejected> {
  const { onProgress } = ctx;

  const outcome = await runProposalPipeline(ctx, auditDir, {
    skipTriage,
    triageRunner,
    progress: {
      onAssess: (msg) => onProgress("assess", msg),
      onAssessSaved: (path) => onProgress("assess", `Saved: ${path}`),
      onName: (msg) => onProgress("name", msg),
      onTriageStart: () => onProgress("triage", "Running triage..."),
      onTriageAccepted: () => onProgress("triage", "Triage accepted."),
      onTriageRejected: (reason) => onProgress("triage", `Triage rejected: ${reason}`),
    },
  });

  if (outcome.rejected) {
    return {
      rejected: true,
      result: buildSkippedResult({
        name: outcome.name,
        assessment: outcome.assessment,
        success: true,
        structuredAssessment: outcome.structuredAssessment,
        triageResult: outcome.triageResult,
        charterCheck,
        skippedReason: `Triage: ${outcome.reason}`,
      }),
    };
  }

  return {
    rejected: false,
    name: outcome.name,
    assessment: outcome.assessment,
    structuredAssessment: outcome.structuredAssessment,
    triageResult: outcome.triageResult,
  };
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

  const { folder, config, onProgress } = ctx;

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
    return buildSkippedResult({
      gatesResult: preambleResult.gatesResult ?? null,
      charterCheck: preambleResult.charterCheck,
      skippedReason: preambleResult.failureReason,
    });
  }

  const charterCheckResult = preambleResult.charterCheck;
  const preflightGates = preambleResult.gates;

  const auditDir = await ensureAuditDir(folder, config.auditDir);

  // --- Stages 1–3: Assess, Name, Triage ---
  const assessResult = await runAssessAndTriage(ctx, auditDir, charterCheckResult, skipTriage, triageRunner);
  if (assessResult.rejected) {
    return assessResult.result;
  }

  const { name, assessment, structuredAssessment, triageResult } = assessResult;

  // --- Stage 4: Plan ---
  onProgress("plan", "Creating plan...");
  const plan = await runPlanStage(ctx, assessment);

  const planPath = await saveStageOutput(auditDir, name, "plan", plan);
  onProgress("plan", `Saved: ${planPath}`);

  // --- Stage 5: Execute + Verify ---
  const execResult = await runExecuteWithVerify(ctx, buildExecutePrompt(folder, assessment, plan), {
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

  return buildCompletedResult({
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
    headline,
    summary,
  });
}
