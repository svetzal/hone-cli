import { buildClaudeArgs } from "./claude.ts";
import { gatherContext, type ProjectContext } from "./derive.ts";
import { parseGatesJson } from "./extract-gates.ts";
import type { ClaudeInvoker, GateDefinition } from "./types.ts";
import { renderProjectContextSections } from "./prompt-context.ts";

export function buildDeriveGatesPrompt(
  folder: string,
  context: ProjectContext,
  agentContent?: string,
): string {
  const sections: string[] = [
    "You are discovering quality gates for a software project by inspecting its actual tooling.",
    "You have Read, Glob, and Grep tools available. Use them to explore the project's",
    "build files, CI configs, tool configs, and scripts to identify quality gate commands.",
    "",
    ...renderProjectContextSections(folder, context),
  ];

  if (agentContent) {
    sections.push(
      "",
      "## Agent Context",
      "",
      "An agent definition is provided below. Use it to understand which quality dimensions",
      "matter for this project (testing, linting, security, type checking, etc.), but derive",
      "all gate commands from actual project files — never from the agent text alone.",
      "",
      "```",
      agentContent,
      "```",
    );
  }

  sections.push(
    "",
    "## Exploration Instructions",
    "",
    "Inspect the project to discover quality gate commands:",
    "",
    "1. **Read package/build files** for scripts (test, lint, build, typecheck, format, check)",
    "2. **Read CI configuration files** for pipeline commands (test steps, lint steps, etc.)",
    "3. **Read tool configuration files** to understand what tools are configured",
    "4. **Check for Makefile, Justfile, or Taskfile** targets",
    "5. **Check for shell scripts** that wrap quality commands",
    "",
    "## Output Rules",
    "",
    "- Output ONLY a JSON array of gate objects, no markdown, no explanation, no backticks",
    "- Each gate has: `name` (short identifier), `command` (exact shell command), `required` (boolean)",
    "- Never invent commands — every gate command must come from a file you actually read",
    "- Combine related commands with && when they form a single gate (e.g., lint + format check)",
    "- Mark security/audit gates as `required: false`",
    "- Mark test, lint, typecheck, and format gates as `required: true`",
    "- If no quality commands are found, output an empty array: []",
    "",
    "## Example Output",
    "",
    '[{"name":"test","command":"bun test","required":true},{"name":"typecheck","command":"bunx tsc --noEmit","required":true}]',
  );

  return sections.join("\n");
}

export async function deriveGates(
  folder: string,
  model: string,
  readOnlyTools: string,
  claude: ClaudeInvoker,
  agentContent?: string,
): Promise<GateDefinition[]> {
  const context = await gatherContext(folder);
  const prompt = buildDeriveGatesPrompt(folder, context, agentContent);

  const args = buildClaudeArgs({
    model,
    prompt,
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
