import { readAgentContent } from "./agents.ts";
import { invokeReadOnlyStage } from "./claude.ts";
import { errorMessage, warn } from "./errors.ts";
import { extractJsonArrayFromLlmOutput, warnOnMalformedJson } from "./json-extraction.ts";
import type { ClaudeContext, GateDefinition } from "./types.ts";

export const EXTRACTION_PROMPT = `You are analyzing a Claude agent definition file. Extract all quality assurance gate commands that this agent expects to be run against a project.

Look for sections about:
- QA checkpoints, quality gates, or verification steps
- Test commands (e.g., "bun test", "npm test", "mix test", "pytest")
- Lint commands (e.g., "npm run lint", "mix credo", "ruff check")
- Format check commands (e.g., "mix format --check-formatted", "ruff format --check")
- Security audit commands (e.g., "npm audit", "mix deps.audit", "pip-audit")
- Type check commands (e.g., "tsc --noEmit", "mypy")

Output ONLY a JSON array of gate objects. Each gate has:
- "name": short identifier (e.g., "test", "lint", "security", "typecheck")
- "command": the exact shell command to run
- "required": true if the gate is mandatory, false if optional (security audits are typically optional)

If no gates can be identified, output an empty array: []

Example output:
[
  {"name": "test", "command": "bun test", "required": true},
  {"name": "lint", "command": "tsc --noEmit", "required": true}
]

Rules:
- Output ONLY valid JSON, no markdown, no explanation, no backticks
- Combine related commands with && when they form a single gate (e.g., lint + format check)
- Mark security/audit gates as required: false

Agent content:
`;

export async function extractGatesFromAgentContent(
  agentContent: string,
  ctx: ClaudeContext,
): Promise<GateDefinition[]> {
  try {
    const output = await invokeReadOnlyStage(ctx, EXTRACTION_PROMPT + agentContent);
    return parseGatesJson(output);
  } catch (err) {
    warn(`Gate extraction failed: ${errorMessage(err)}`);
    throw err;
  }
}

export async function extractGatesFromAgent(agentName: string, ctx: ClaudeContext): Promise<GateDefinition[]> {
  const content = await readAgentContent(agentName);
  if (!content) return [];

  return extractGatesFromAgentContent(content, ctx);
}

export function parseGatesJson(raw: string): GateDefinition[] {
  const result = extractJsonArrayFromLlmOutput(raw);
  const value = warnOnMalformedJson(result, "Gate extraction response");
  if (!value) return [];

  return value
    .filter(
      (g: unknown): g is { name: string; command: string; required?: boolean; fix_command?: string } =>
        typeof g === "object" &&
        g !== null &&
        typeof (g as Record<string, unknown>).name === "string" &&
        typeof (g as Record<string, unknown>).command === "string",
    )
    .map((g) => ({
      name: g.name,
      command: g.command,
      required: g.required ?? true,
      ...(typeof g.fix_command === "string" && { fix_command: g.fix_command }),
    }));
}
