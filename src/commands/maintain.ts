import { loadConfig } from "../config.ts";
import { maintain } from "../maintain.ts";
import { createClaudeInvoker } from "../claude.ts";
import type { ParsedArgs, HoneConfig, PipelineContext } from "../types.ts";
import { writeJson, createProgressCallback } from "../output.ts";
import { applySharedFlags } from "./shared-flags.ts";
import { resolveCommandArgs } from "./resolve-command-args.ts";

export function applyMaintainFlags(config: HoneConfig, flags: Record<string, string | boolean>): HoneConfig {
  return applySharedFlags(config, flags);
}

export async function maintainCommand(parsed: ParsedArgs): Promise<void> {
  const { agent, resolvedFolder } = await resolveCommandArgs(parsed, "maintain");

  const baseConfig = await loadConfig();
  const config = applyMaintainFlags(baseConfig, parsed.flags);

  const isJson = parsed.flags.json === true;

  const onProgress = createProgressCallback(isJson);
  const claude = createClaudeInvoker({ cwd: resolvedFolder });
  const ctx: PipelineContext = { agent, folder: resolvedFolder, config, claude, onProgress };

  const result = await maintain({ ctx });

  if (isJson) {
    writeJson(result);
  }

  if (!result.success) {
    process.exit(1);
  }
}
