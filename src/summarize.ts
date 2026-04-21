import { buildClaudeArgs } from "./claude.ts";
import { warn } from "./errors.ts";
import { extractJsonFromLlmOutput } from "./json-extraction.ts";
import type { ClaudeInvoker, GatesRunResult, StructuredAssessment, TriageResult } from "./types.ts";

export interface SummarizeResult {
  headline: string;
  summary: string;
}

export interface IterateSummarizeContext {
  name: string;
  structuredAssessment: StructuredAssessment | null;
  triageResult: TriageResult | null;
  execution: string;
  retries: number;
  gatesResult: GatesRunResult | null;
}

export interface MaintainSummarizeContext {
  name: string;
  execution: string;
  retries: number;
  gatesResult: GatesRunResult | null;
}

function formatGatesStatus(gatesResult: GatesRunResult | null): string {
  if (!gatesResult) return "no gates configured";
  const failed = gatesResult.results.filter((r) => !r.passed);
  if (failed.length === 0) return "all gates passed";
  return `${failed.length} gate(s) failed`;
}

function buildSummarizePromptTail(execution: string): string[] {
  const excerpt = execution.slice(0, 500);
  return [
    "",
    "What was done (excerpt):",
    excerpt,
    "",
    "Respond with ONLY a JSON object:",
    "```json",
    '{ "headline": "<imperative, single-line, max 72 chars, for git commit subject>",',
    '  "summary": "<2-5 lines for git commit body>" }',
    "```",
  ];
}

export function buildIterateSummarizePrompt(ctx: IterateSummarizeContext): string {
  const severity = ctx.structuredAssessment?.severity ?? "unknown";
  const principle = ctx.structuredAssessment?.principle ?? "unknown";
  const category = ctx.structuredAssessment?.category ?? "unknown";
  const changeType = ctx.triageResult?.changeType ?? "unknown";

  return [
    "Generate a headline and summary for a code improvement.",
    "",
    "Context:",
    `- Principle: ${principle}`,
    `- Severity: ${severity}/5`,
    `- Category: ${category}`,
    `- Change type: ${changeType}`,
    `- Retries: ${ctx.retries}`,
    `- Gates: ${formatGatesStatus(ctx.gatesResult)}`,
    ...buildSummarizePromptTail(ctx.execution),
  ].join("\n");
}

export function buildMaintainSummarizePrompt(ctx: MaintainSummarizeContext): string {
  return [
    "Generate a headline and summary for a dependency maintenance update.",
    "",
    "Context:",
    `- Retries: ${ctx.retries}`,
    `- Gates: ${formatGatesStatus(ctx.gatesResult)}`,
    ...buildSummarizePromptTail(ctx.execution),
  ].join("\n");
}

export function parseSummarizeResponse(raw: string): SummarizeResult | null {
  const result = extractJsonFromLlmOutput(raw);
  if (result.kind !== "parsed") {
    if (result.kind === "malformed") {
      warn(`Summarize response contained malformed JSON: ${raw.slice(0, 200)}`);
    }
    return null;
  }

  const json = result.value;
  if (typeof json.headline !== "string" || typeof json.summary !== "string") {
    warn("Summarize response missing required fields: headline and summary");
    return null;
  }

  return {
    headline: json.headline,
    summary: json.summary,
  };
}

export async function summarize(
  prompt: string,
  model: string,
  readOnlyTools: string,
  claude: ClaudeInvoker,
): Promise<SummarizeResult | null> {
  const args = buildClaudeArgs({
    model,
    prompt,
    readOnly: true,
    readOnlyTools,
  });
  const raw = await claude(args);
  return parseSummarizeResponse(raw);
}
