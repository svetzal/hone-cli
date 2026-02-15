import { resolve, join } from "path";
import { loadConfig } from "../config.ts";
import { agentExists } from "../agents.ts";
import { maintain } from "../maintain.ts";
import { createClaudeInvoker } from "../claude.ts";
import type { ParsedArgs, HoneConfig } from "../types.ts";
import { writeJson } from "../output.ts";

export function applyMaintainFlags(config: HoneConfig, flags: Record<string, string | boolean>): HoneConfig {
  const result = { ...config, models: { ...config.models } };

  if (typeof flags["max-retries"] === "string") {
    result.maxRetries = parseInt(flags["max-retries"], 10);
  }
  if (typeof flags["execute-model"] === "string") {
    result.models.execute = flags["execute-model"];
  }
  if (typeof flags["summarize-model"] === "string") {
    result.models.summarize = flags["summarize-model"];
  }

  return result;
}

export async function maintainCommand(parsed: ParsedArgs): Promise<void> {
  const agent = parsed.positional[0];
  const folder = parsed.positional[1];

  if (!agent || !folder) {
    console.error("Usage: hone maintain <agent> <folder>");
    console.error("  agent  - Claude agent name (e.g., typescript-craftsperson)");
    console.error("  folder - Project folder to maintain");
    process.exit(1);
  }

  const resolvedFolder = resolve(folder);
  const localAgentsDir = join(resolvedFolder, ".claude", "agents");

  if (!(await agentExists(agent)) && !(await agentExists(agent, localAgentsDir))) {
    console.error(`Agent '${agent}' not found in ~/.claude/agents/ or ${localAgentsDir}/`);
    console.error("Run 'hone list-agents' to see available agents.");
    process.exit(1);
  }

  const baseConfig = await loadConfig();
  const config = applyMaintainFlags(baseConfig, parsed.flags);

  const isJson = parsed.flags.json === true;

  const onProgress = (stage: string, message: string) => {
    if (isJson) {
      console.error(`==> [${stage}] ${message}`);
    } else {
      console.log(`==> [${stage}] ${message}`);
    }
  };

  const result = await maintain(
    {
      agent,
      folder: resolvedFolder,
      config,
      onProgress,
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
