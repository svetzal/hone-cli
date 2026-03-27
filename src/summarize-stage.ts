import { summarize as runSummarize } from "./summarize.ts";
import type { ClaudeInvoker, HoneConfig } from "./types.ts";

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
  config: HoneConfig,
  claude: ClaudeInvoker,
  onProgress: (stage: string, message: string) => void,
): Promise<SummarizeStageResult> {
  try {
    onProgress("summarize", "Generating headline and summary...");
    const result = await runSummarize(
      buildPrompt(),
      config.models.summarize,
      config.readOnlyTools,
      claude,
    );
    if (result) {
      return { headline: result.headline, summary: result.summary };
    }
  } catch {
    // Summarize is cosmetic — never block the pipeline
  }
  return { headline: null, summary: null };
}
