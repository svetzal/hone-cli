import { resolve } from "path";
import { loadConfig } from "../config.ts";
import { agentExists } from "../agents.ts";
import { iterate } from "../iterate.ts";
import { createClaudeInvoker } from "../claude.ts";
import type { ParsedArgs } from "../types.ts";

export async function iterateCommand(parsed: ParsedArgs): Promise<void> {
  const agent = parsed.positional[0];
  const folder = parsed.positional[1];

  if (!agent || !folder) {
    console.error("Usage: hone iterate <agent> <folder>");
    console.error("  agent  - Claude agent name (e.g., typescript-craftsperson)");
    console.error("  folder - Project folder to assess");
    process.exit(1);
  }

  if (!(await agentExists(agent))) {
    console.error(`Agent '${agent}' not found in ~/.claude/agents/`);
    console.error("Run 'hone list-agents' to see available agents.");
    process.exit(1);
  }

  const resolvedFolder = resolve(folder);

  const config = await loadConfig();

  // Apply flag overrides
  if (typeof parsed.flags["max-retries"] === "string") {
    config.maxRetries = parseInt(parsed.flags["max-retries"], 10);
  }
  if (typeof parsed.flags["assess-model"] === "string") {
    config.models.assess = parsed.flags["assess-model"];
  }
  if (typeof parsed.flags["plan-model"] === "string") {
    config.models.plan = parsed.flags["plan-model"];
  }
  if (typeof parsed.flags["execute-model"] === "string") {
    config.models.execute = parsed.flags["execute-model"];
  }

  const skipGates = parsed.flags["skip-gates"] === true;

  const result = await iterate(
    {
      agent,
      folder: resolvedFolder,
      config,
      skipGates,
      onProgress: (stage, message) => {
        console.log(`==> [${stage}] ${message}`);
      },
    },
    createClaudeInvoker(),
  );

  if (!result.success) {
    process.exit(1);
  }
}
