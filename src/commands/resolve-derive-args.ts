import { resolve } from "node:path";
import { CliError } from "../errors.ts";
import type { ParsedArgs } from "../types.ts";

export interface ResolvedDeriveArgs {
  resolvedFolder: string;
  isGlobal: boolean;
  isJson: boolean;
  nameOverride: string | undefined;
}

export function resolveDeriveArgs(parsed: ParsedArgs): ResolvedDeriveArgs {
  const folder = parsed.positional[0];

  if (!folder) {
    throw new CliError(
      "Usage: hone derive <folder> [--local | --global] [--name <name>]\n" +
        "  folder   - Project folder to inspect\n" +
        "  --local  - Write agent to <folder>/.claude/agents/ (default)\n" +
        "  --global - Write agent to ~/.claude/agents/\n" +
        "  --name   - Override agent name (skip Claude's naming)",
    );
  }

  return {
    resolvedFolder: resolve(folder),
    isGlobal: parsed.flags.global === true,
    isJson: parsed.flags.json === true,
    nameOverride: typeof parsed.flags.name === "string" ? parsed.flags.name : undefined,
  };
}
