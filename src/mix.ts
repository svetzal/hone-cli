import { buildClaudeArgs } from "./claude.ts";
import { EXTRACTION_PROMPT, parseGatesJson } from "./extract-gates.ts";
import type { ClaudeInvoker, GateDefinition } from "./types.ts";

export interface MixOptions {
  localAgentContent: string;
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

export function buildPrinciplesMixPrompt(localContent: string, foreignContent: string): string {
  return `You are augmenting a LOCAL agent's engineering principles with ideas from a FOREIGN agent.

## LOCAL Agent (the one being updated)
<local-agent>
${localContent}
</local-agent>

## FOREIGN Agent (source of new ideas)
<foreign-agent>
${foreignContent}
</foreign-agent>

## Instructions

Compare the engineering principles and design philosophies in both agents. Augment the LOCAL agent by filling gaps — add principles from the FOREIGN agent that the LOCAL agent lacks.

Rules:
- ONLY modify sections related to engineering principles, design philosophies, or craftsmanship ideals
- DO NOT touch QA checkpoints, quality gates, language guidelines, architecture sections, tool stack, anti-patterns, self-correction, escalation, or any other sections
- Existing local principles take priority — do not override or weaken them
- Skip foreign principles that conflict with or contradict local ones
- Adapt wording to match the local agent's style, tone, and technology context
- Do not duplicate principles that are already covered (even if worded differently)
- Preserve the local agent's overall structure and formatting

Output the complete updated LOCAL agent file. No surrounding explanation.`;
}

export function buildGatesMixPrompt(localContent: string, foreignContent: string): string {
  return `You are augmenting a LOCAL agent's quality assurance checkpoints with ideas from a FOREIGN agent.

## LOCAL Agent (the one being updated)
<local-agent>
${localContent}
</local-agent>

## FOREIGN Agent (source of new ideas)
<foreign-agent>
${foreignContent}
</foreign-agent>

## Instructions

Compare the QA checkpoints and quality gates in both agents. Augment the LOCAL agent by filling gaps — add gate ideas from the FOREIGN agent that the LOCAL agent lacks.

Rules:
- ONLY modify sections related to QA checkpoints, quality gates, or verification steps
- DO NOT touch engineering principles, design philosophies, language guidelines, architecture sections, tool stack, anti-patterns, self-correction, escalation, or any other sections
- Technology match is mandatory — do not add gates from incompatible tech stacks (e.g., no \`tsc\` in a Python agent, no \`mix test\` in a TypeScript agent)
- Adapt commands to the local project's actual tooling and conventions
- Skip redundant gates that cover the same concern as existing ones
- Existing local gates take priority — do not override or weaken them
- Preserve the local agent's overall structure and formatting

Output the complete updated LOCAL agent file. No surrounding explanation.`;
}

export async function mix(opts: MixOptions, claude: ClaudeInvoker): Promise<MixResult> {
  let currentContent = opts.localAgentContent;
  let principlesMixed = false;
  let gatesMixed = false;

  if (opts.mixPrinciples) {
    const prompt = buildPrinciplesMixPrompt(currentContent, opts.foreignAgentContent);
    const args = buildClaudeArgs({
      model: opts.model,
      prompt,
      readOnly: true,
      readOnlyTools: opts.readOnlyTools,
    });
    currentContent = await claude(args);
    principlesMixed = true;
  }

  if (opts.mixGates) {
    const prompt = buildGatesMixPrompt(currentContent, opts.foreignAgentContent);
    const args = buildClaudeArgs({
      model: opts.model,
      prompt,
      readOnly: true,
      readOnlyTools: opts.readOnlyTools,
    });
    currentContent = await claude(args);
    gatesMixed = true;
  }

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
      prompt: EXTRACTION_PROMPT + currentContent,
      readOnly: true,
      readOnlyTools: opts.readOnlyTools,
    });
    try {
      const output = await claude(extractArgs);
      // Validate output contains a parseable JSON array before trusting it.
      // parseGatesJson returns [] for both "valid empty" and "malformed" —
      // this pre-check distinguishes the two.
      const match = output.match(/\[[\s\S]*\]/);
      if (match && Array.isArray(JSON.parse(match[0]))) {
        gates = parseGatesJson(output);
      }
    } catch {
      // Claude process failure or JSON.parse failure — both mean extraction failed
      gates = null;
    }
  }

  return { updatedAgentContent: currentContent, principlesMixed, gatesMixed, gates };
}
