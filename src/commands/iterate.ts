import { loadConfig } from "../config.ts";
import { CliError, SilentExitError } from "../errors.ts";
import { githubIterate } from "../github-iterate.ts";
import { iterate } from "../iterate.ts";
import { writeJson } from "../output.ts";
import { assertNotRecursive } from "../recursion-guard.ts";
import type { HoneConfig, HoneMode, ParsedArgs } from "../types.ts";
import { buildPipelineContext } from "./build-pipeline-context.ts";
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
    const parsed = parseInt(flags["severity-threshold"], 10);
    if (Number.isNaN(parsed))
      throw new CliError(`--severity-threshold must be an integer, got: ${flags["severity-threshold"]}`);
    result.severityThreshold = parsed;
  }
  if (typeof flags["min-charter-length"] === "string") {
    const parsed = parseInt(flags["min-charter-length"], 10);
    if (Number.isNaN(parsed))
      throw new CliError(`--min-charter-length must be an integer, got: ${flags["min-charter-length"]}`);
    result.minCharterLength = parsed;
  }

  return result;
}

export async function iterateCommand(parsed: ParsedArgs): Promise<void> {
  assertNotRecursive("iterate");
  const { agent, resolvedFolder } = await resolveCommandArgs(parsed, "iterate");

  const baseConfig = await loadConfig();
  const config = applyIterateFlags(baseConfig, parsed.flags);

  const skipGates = parsed.flags["skip-gates"] === true;
  const skipCharter = parsed.flags["skip-charter"] === true;
  const skipTriage = parsed.flags["skip-triage"] === true;
  const isJson = parsed.flags.json === true;
  const mode = config.mode;

  const ctx = buildPipelineContext(agent, resolvedFolder, config, isJson);

  if (mode === "github") {
    const proposalsFlag = parsed.flags.proposals;
    let proposals = 1;
    if (typeof proposalsFlag === "string") {
      const parsed2 = parseInt(proposalsFlag, 10);
      if (Number.isNaN(parsed2)) throw new CliError(`--proposals must be an integer, got: ${proposalsFlag}`);
      proposals = parsed2;
    }

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
      ctx.onProgress("result", result.skippedReason);
    }

    if (isJson) {
      writeJson(result);
    }

    if (!result.success) {
      throw new SilentExitError();
    }
  }
}
