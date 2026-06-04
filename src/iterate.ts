import { ensureAuditDir, saveStageOutput } from "./audit.ts";
import { checkCharter } from "./charter.ts";
import { runExecuteWithVerify } from "./execute-with-verify.ts";
import { runAllGates } from "./gates.ts";
import { buildExecutePrompt, buildRetryPrompt, runPlanStage, runProposalPipeline } from "./pipeline.ts";
import { runPreamble } from "./preamble.ts";
import { resolveGates } from "./resolve-gates.ts";
import { buildIterateSummarizePrompt } from "./summarize.ts";
import { summarizeOnSuccess } from "./summarize-stage.ts";
import { triage as runTriage } from "./triage.ts";
import type {
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
  const { headline, summary } = await summarizeOnSuccess(
    execResult.success,
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
