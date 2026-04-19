import { buildClaudeArgs } from "./claude.ts";
import { EXTRACTION_PROMPT, parseGatesJson } from "./extract-gates.ts";
import { extractJsonArrayFromLlmOutput } from "./json-extraction.ts";
import type { ClaudeInvoker, GateDefinition } from "./types.ts";

export type FileReader = (path: string) => Promise<string>;

export interface MixOptions {
  agentPath: string;
  foreignAgentContent: string;
  mixPrinciples: boolean;
  mixGates: boolean;
  model: string;
  gatesModel: string;
  readOnlyTools: string;
}

export interface MixResult {
  updatedAgentContent: string;
  principlesMixed: boolean;
  gatesMixed: boolean;
  gates: GateDefinition[] | null;
}

export function buildPrinciplesMixPrompt(foreignContent: string, agentPath: string): string {
  return `You are augmenting a local agent's engineering principles with ideas from a foreign agent.

The local agent file to update is at: ${agentPath}
Read this file, then use the Edit tool to add missing principles from the foreign agent below.

## Foreign Agent (source of new ideas)
<foreign-agent>
${foreignContent}
</foreign-agent>

## Instructions

Compare the engineering principles and design philosophies in both agents. Augment the local agent by filling gaps — add principles from the foreign agent that the local agent lacks.

Rules:
- ONLY modify sections related to engineering principles, design philosophies, or craftsmanship ideals
- DO NOT touch QA checkpoints, quality gates, language guidelines, architecture sections, tool stack, anti-patterns, self-correction, escalation, or any other sections
- Existing local principles take priority — do not override or weaken them
- Skip foreign principles that conflict with or contradict local ones
- Adapt wording to match the local agent's style, tone, and technology context
- Do not duplicate principles that are already covered (even if worded differently)
- Preserve the local agent's overall structure and formatting
- Use the Edit tool to make targeted changes — do not rewrite the entire file`;
}

export function buildGatesMixPrompt(foreignContent: string, agentPath: string): string {
  return `You are augmenting a local agent's quality assurance checkpoints with ideas from a foreign agent.

The local agent file to update is at: ${agentPath}
Read this file, then use the Edit tool to add missing gate ideas from the foreign agent below.

## Foreign Agent (source of new ideas)
<foreign-agent>
${foreignContent}
</foreign-agent>

## Instructions

Compare the QA checkpoints and quality gates in both agents. Augment the local agent by filling gaps — add gate ideas from the foreign agent that the local agent lacks.

Rules:
- ONLY modify sections related to QA checkpoints, quality gates, or verification steps
- DO NOT touch engineering principles, design philosophies, language guidelines, architecture sections, tool stack, anti-patterns, self-correction, escalation, or any other sections
- Technology match is mandatory — do not add gates from incompatible tech stacks (e.g., no \`tsc\` in a Python agent, no \`mix test\` in a TypeScript agent)
- Adapt commands to the local project's actual tooling and conventions
- Skip redundant gates that cover the same concern as existing ones
- Existing local gates take priority — do not override or weaken them
- Preserve the local agent's overall structure and formatting
- Use the Edit tool to make targeted changes — do not rewrite the entire file`;
}

export async function mix(opts: MixOptions, claude: ClaudeInvoker, readFile: FileReader): Promise<MixResult> {
  let principlesMixed = false;
  let gatesMixed = false;

  if (opts.mixPrinciples) {
    const prompt = buildPrinciplesMixPrompt(opts.foreignAgentContent, opts.agentPath);
    const args = buildClaudeArgs({
      model: opts.model,
      prompt,
      readOnly: false,
      readOnlyTools: opts.readOnlyTools,
    });
    await claude(args); // Claude edits the file directly; stdout ignored
    principlesMixed = true;
  }

  if (opts.mixGates) {
    const prompt = buildGatesMixPrompt(opts.foreignAgentContent, opts.agentPath);
    const args = buildClaudeArgs({
      model: opts.model,
      prompt,
      readOnly: false,
      readOnlyTools: opts.readOnlyTools,
    });
    await claude(args); // Claude edits the file directly; stdout ignored
    gatesMixed = true;
  }

  // Read the updated content back from disk after Claude's edits
  const updatedContent = await readFile(opts.agentPath);

  // Extract gates directly (not via extractGatesFromAgentContent) so we can
  // distinguish "extraction failed" (null — don't clobber existing gate file)
  // from "no gates found" ([] — valid result, safe to write).
  //
  // Three failure modes all produce null:
  // 1. Claude process failure (throws)
  // 2. Output contains no JSON array (malformed)
  // 3. JSON array is not valid JSON (malformed)
  let gates: GateDefinition[] | null = null;
  if (gatesMixed) {
    const extractArgs = buildClaudeArgs({
      model: opts.gatesModel,
      prompt: EXTRACTION_PROMPT + updatedContent,
      readOnly: true,
      readOnlyTools: opts.readOnlyTools,
    });
    try {
      const output = await claude(extractArgs);
      // extractJsonArrayFromLlmOutput distinguishes "no valid array found" (no-json/malformed)
      // from "parsed" — only proceed when we got a real array back.
      const extractResult = extractJsonArrayFromLlmOutput(output);
      if (extractResult.kind === "parsed") {
        gates = parseGatesJson(output);
      }
    } catch {
      // Claude process failure — extraction failed
      gates = null;
    }
  }

  return { updatedAgentContent: updatedContent, principlesMixed, gatesMixed, gates };
}
