import { saveStageOutput } from "./audit.ts";
import { claudeCtx, invokeReadOnlyStage } from "./claude.ts";
import { parseAssessment } from "./parse-assessment.ts";
import { PROMPT_ANCHORS } from "./prompt-anchors.ts";
import { RECURSION_GUARD } from "./recursion-guard.ts";
import { buildRetryPromptScaffold } from "./retry-formatting.ts";
import type { AttemptRecord, PipelineContext, StructuredAssessment, TriageResult, TriageRunnerFn } from "./types.ts";

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
    `${PROMPT_ANCHORS.execute} for the project at ${folder}.`,
    RECURSION_GUARD,
    "",
    `Execute the following plan to improve the project in ${folder}.`,
    "",
    "Why:",
    assessment,
    "",
    "Plan:",
    plan,
  ].join("\n");
}

export async function runAssessStage(ctx: PipelineContext): Promise<string> {
  const { agent, folder } = ctx;
  return invokeReadOnlyStage(
    claudeCtx(ctx, "assess"),
    [
      `${PROMPT_ANCHORS.assess} ${folder} against your principles.`,
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
    { agent },
  );
}

export async function runNameStage(ctx: PipelineContext, assessment: string): Promise<string> {
  const { agent } = ctx;
  const rawName = await invokeReadOnlyStage(
    claudeCtx(ctx, "name"),
    [
      `${PROMPT_ANCHORS.name} (no extension) summarizing the main issue.`,
      "Rules: lowercase, hyphens only, no spaces, no backticks, no explanation, max 50 chars.",
      "Example: fix-duplicate-api-helpers",
      "",
      "Assessment:",
      assessment,
    ].join("\n"),
    { agent },
  );
  return sanitizeName(rawName) || `assessment-${Date.now()}`;
}

export async function runPlanStage(ctx: PipelineContext, assessment: string): Promise<string> {
  const { agent } = ctx;
  return invokeReadOnlyStage(
    claudeCtx(ctx, "plan"),
    [
      `${PROMPT_ANCHORS.plan}, create a step-by-step plan to address the issues identified.`,
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
    { agent },
  );
}

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

export async function runProposalPipeline(
  ctx: PipelineContext,
  auditDir: string,
  opts: { skipTriage: boolean; triageRunner: TriageRunnerFn; progress: ProposalProgress },
): Promise<ProposalPipelineOutcome> {
  const { config } = ctx;
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
    const triageResult = await triageRunner(structuredAssessment, config.severityThreshold, claudeCtx(ctx, "triage"));

    if (!triageResult.accepted) {
      progress.onTriageRejected(triageResult.reason);
      return { rejected: true, reason: triageResult.reason, name, assessment, structuredAssessment, triageResult };
    }
    progress.onTriageAccepted();
    return { rejected: false, name, assessment, structuredAssessment, triageResult };
  }

  return { rejected: false, name, assessment, structuredAssessment, triageResult: null };
}
