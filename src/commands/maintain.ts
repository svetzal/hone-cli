import { loadConfig } from "../config.ts";
import { CliError } from "../errors.ts";
import { maintain } from "../maintain.ts";
import { writeJson } from "../output.ts";
import type { HoneConfig, ParsedArgs } from "../types.ts";
import { buildPipelineContext } from "./build-pipeline-context.ts";
import { resolveCommandArgs } from "./resolve-command-args.ts";
import { applySharedFlags } from "./shared-flags.ts";

export function applyMaintainFlags(config: HoneConfig, flags: Record<string, string | boolean>): HoneConfig {
  return applySharedFlags(config, flags);
}

export async function maintainCommand(parsed: ParsedArgs): Promise<void> {
  const { agent, resolvedFolder } = await resolveCommandArgs(parsed, "maintain");

  const baseConfig = await loadConfig();
  const config = applyMaintainFlags(baseConfig, parsed.flags);

  const isJson = parsed.flags.json === true;

  const ctx = buildPipelineContext(agent, resolvedFolder, config, isJson);

  const result = await maintain({ ctx });

  if (isJson) {
    writeJson(result);
  }

  if (!result.success) {
    throw new CliError("");
  }
}
