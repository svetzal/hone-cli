import { createClaudeInvoker } from "../claude.ts";
import { loadConfig } from "../config.ts";
import { CliError } from "../errors.ts";
import { githubIterate } from "../github-iterate.ts";
import { iterate } from "../iterate.ts";
import { createProgressCallback, writeJson } from "../output.ts";
import type { HoneConfig, HoneMode, ParsedArgs, PipelineContext } from "../types.ts";
import { resolveCommandArgs } from "./resolve-command-args.ts";
import { applySharedFlags } from "./shared-flags.ts";

export function applyIterateFlags(config: HoneConfig, flags: Record<string, string | boolean>): HoneConfig {
  const result = applySharedFlags(config, flags);

  if (typeof flags["assess-model"] === "string") {
    result.models.assess = flags["assess-model"];
  }
  if (typeof flags["plan-model"] === "string") {
    result.models.plan = flags["plan-model"];
  }
  if (typeof flags.mode === "string") {
    result.mode = flags.mode as HoneMode;
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
  const { agent, resolvedFolder } = await resolveCommandArgs(parsed, "iterate");

  const baseConfig = await loadConfig();
  const config = applyIterateFlags(baseConfig, parsed.flags);

  const skipGates = parsed.flags["skip-gates"] === true;
  const skipCharter = parsed.flags["skip-charter"] === true;
  const skipTriage = parsed.flags["skip-triage"] === true;
  const isJson = parsed.flags.json === true;
  const mode = config.mode;

  const onProgress = createProgressCallback(isJson);
  const claude = createClaudeInvoker({ cwd: resolvedFolder });
  const ctx: PipelineContext = { agent, folder: resolvedFolder, config, claude, onProgress };

  if (mode === "github") {
    const proposalsFlag = parsed.flags.proposals;
    const proposals = typeof proposalsFlag === "string" ? parseInt(proposalsFlag, 10) : 1;

    const result = await githubIterate({
      ctx,
      proposals,
      skipGates,
      skipTriage,
      skipCharter,
    });

    if (isJson) {
      writeJson(result);
    }
  } else {
    // Local mode
    if (parsed.flags.proposals !== undefined) {
      throw new CliError("--proposals is only available in github mode");
    }

    const result = await iterate({
      ctx,
      skipGates,
      skipCharter,
      skipTriage,
    });

    if (result.kind === "skipped") {
      onProgress("result", result.skippedReason);
    }

    if (isJson) {
      writeJson(result);
    }

    if (!result.success) {
      throw new CliError("");
    }
  }
}
