import { claudeCtx } from "./claude.ts";
import { summarize as runSummarize } from "./summarize.ts";
import type { PipelineContext } from "./types.ts";

export interface SummarizeStageResult {
  headline: string | null;
  summary: string | null;
}

/**
 * Run the summarize stage as a non-blocking cosmetic step.
 * On any error, returns nulls — summarize failures never block the pipeline.
 */
export async function runSummarizeStage(
  buildPrompt: () => string,
  ctx: PipelineContext,
): Promise<SummarizeStageResult> {
  const { onProgress } = ctx;
  try {
    onProgress("summarize", "Generating headline and summary...");
    const result = await runSummarize(buildPrompt(), claudeCtx(ctx, "summarize"));
    if (result) {
      return { headline: result.headline, summary: result.summary };
    }
  } catch {
    // Summarize is cosmetic — never block the pipeline
  }
  return { headline: null, summary: null };
}

export async function summarizeOnSuccess(
  success: boolean,
  buildPrompt: () => string,
  ctx: PipelineContext,
): Promise<SummarizeStageResult> {
  if (!success) return { headline: null, summary: null };
  return runSummarizeStage(buildPrompt, ctx);
}
