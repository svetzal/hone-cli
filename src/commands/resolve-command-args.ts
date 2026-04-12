import { join, resolve } from "node:path";
import { validateAgent } from "../agents.ts";
import { CliError } from "../errors.ts";
import type { ParsedArgs } from "../types.ts";

export interface ResolvedCommandArgs {
  agent: string;
  resolvedFolder: string;
}

export async function resolveCommandArgs(parsed: ParsedArgs, commandName: string): Promise<ResolvedCommandArgs> {
  const agent = parsed.positional[0];
  const folder = parsed.positional[1];

  if (!agent || !folder) {
    throw new CliError(
      `Usage: hone ${commandName} <agent> <folder>\n  agent  - Claude agent name (e.g., typescript-craftsperson)\n  folder - Project folder to assess`,
    );
  }

  const resolvedFolder = resolve(folder);
  const localAgentsDir = join(resolvedFolder, ".claude", "agents");

  await validateAgent(agent, localAgentsDir);

  return { agent, resolvedFolder };
}
