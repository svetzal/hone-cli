import { resolve } from "path";
import { loadConfig } from "../config.ts";
import { agentExists } from "../agents.ts";
import { iterate } from "../iterate.ts";
import { createClaudeInvoker } from "../claude.ts";
import type { ParsedArgs, HoneConfig } from "../types.ts";
import { writeJson } from "../output.ts";

export function applyIterateFlags(config: HoneConfig, flags: Record<string, string | boolean>): HoneConfig {
  const result = { ...config, models: { ...config.models } };

  if (typeof flags["max-retries"] === "string") {
    result.maxRetries = parseInt(flags["max-retries"], 10);
  }
  if (typeof flags["assess-model"] === "string") {
    result.models.assess = flags["assess-model"];
  }
  if (typeof flags["plan-model"] === "string") {
    result.models.plan = flags["plan-model"];
  }
  if (typeof flags["execute-model"] === "string") {
    result.models.execute = flags["execute-model"];
  }

  return result;
}

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

  const baseConfig = await loadConfig();
  const config = applyIterateFlags(baseConfig, parsed.flags);

  const skipGates = parsed.flags["skip-gates"] === true;
  const isJson = parsed.flags.json === true;

  const result = await iterate(
    {
      agent,
      folder: resolvedFolder,
      config,
      skipGates,
      onProgress: (stage, message) => {
        if (isJson) {
          // In JSON mode, route progress to stderr to keep stdout clean
          console.error(`==> [${stage}] ${message}`);
        } else {
          console.log(`==> [${stage}] ${message}`);
        }
      },
    },
    createClaudeInvoker(),
  );

  if (isJson) {
    writeJson(result);
  }

  if (!result.success) {
    process.exit(1);
  }
}
