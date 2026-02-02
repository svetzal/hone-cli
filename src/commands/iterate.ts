import { resolve } from "path";
import { loadConfig } from "../config.ts";
import { agentExists } from "../agents.ts";
import { iterate } from "../iterate.ts";
import { githubIterate } from "../github-iterate.ts";
import { createClaudeInvoker } from "../claude.ts";
import type { ParsedArgs, HoneConfig, HoneMode } from "../types.ts";
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
  if (typeof flags["mode"] === "string") {
    result.mode = flags["mode"] as HoneMode;
  }
  if (typeof flags["severity-threshold"] === "string") {
    result.severityThreshold = parseInt(flags["severity-threshold"], 10);
  }
  if (typeof flags["min-charter-length"] === "string") {
    result.minCharterLength = parseInt(flags["min-charter-length"], 10);
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
  const skipCharter = parsed.flags["skip-charter"] === true;
  const skipTriage = parsed.flags["skip-triage"] === true;
  const isJson = parsed.flags.json === true;
  const mode = config.mode;

  const onProgress = (stage: string, message: string) => {
    if (isJson) {
      console.error(`==> [${stage}] ${message}`);
    } else {
      console.log(`==> [${stage}] ${message}`);
    }
  };

  if (mode === "github") {
    const proposalsFlag = parsed.flags["proposals"];
    const proposals = typeof proposalsFlag === "string" ? parseInt(proposalsFlag, 10) : 1;

    const result = await githubIterate(
      {
        agent,
        folder: resolvedFolder,
        config,
        proposals,
        skipGates,
        skipTriage,
        skipCharter,
        onProgress,
      },
      createClaudeInvoker(),
    );

    if (isJson) {
      writeJson(result);
    }
  } else {
    // Local mode
    if (parsed.flags["proposals"] !== undefined) {
      console.error("--proposals is only available in github mode");
      process.exit(1);
    }

    const result = await iterate(
      {
        agent,
        folder: resolvedFolder,
        config,
        skipGates,
        skipCharter,
        skipTriage,
        onProgress,
      },
      createClaudeInvoker(),
    );

    if (result.skippedReason) {
      onProgress("result", result.skippedReason);
    }

    if (isJson) {
      writeJson(result);
    }

    if (!result.success) {
      process.exit(1);
    }
  }
}
