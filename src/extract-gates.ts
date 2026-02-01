import { readAgentContent } from "./agents.ts";
import { buildClaudeArgs } from "./claude.ts";
import type { ClaudeInvoker, GateDefinition } from "./types.ts";

const EXTRACTION_PROMPT = `You are analyzing a Claude agent definition file. Extract all quality assurance gate commands that this agent expects to be run against a project.

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
  model: string,
  readOnlyTools: string,
  claude: ClaudeInvoker,
): Promise<GateDefinition[]> {
  const args = buildClaudeArgs({
    model,
    prompt: EXTRACTION_PROMPT + agentContent,
    readOnly: true,
    readOnlyTools,
  });

  try {
    const output = await claude(args);
    return parseGatesJson(output);
  } catch {
    return [];
  }
}

export async function extractGatesFromAgent(
  agentName: string,
  model: string,
  readOnlyTools: string,
  claude: ClaudeInvoker,
): Promise<GateDefinition[]> {
  const content = await readAgentContent(agentName);
  if (!content) return [];

  return extractGatesFromAgentContent(content, model, readOnlyTools, claude);
}

export function parseGatesJson(raw: string): GateDefinition[] {
  try {
    // Try to extract JSON array from the output (may have surrounding text)
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];

    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (g: unknown): g is { name: string; command: string; required?: boolean } =>
          typeof g === "object" &&
          g !== null &&
          typeof (g as Record<string, unknown>).name === "string" &&
          typeof (g as Record<string, unknown>).command === "string",
      )
      .map((g) => ({
        name: g.name,
        command: g.command,
        required: g.required ?? true,
      }));
  } catch {
    return [];
  }
}
