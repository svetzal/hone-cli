import { resolve, join } from "path";
import { validateAgentOrExit } from "../agents.ts";
import type { ParsedArgs } from "../types.ts";

export interface ResolvedCommandArgs {
  agent: string;
  resolvedFolder: string;
}

export async function resolveCommandArgs(parsed: ParsedArgs, commandName: string): Promise<ResolvedCommandArgs> {
  const agent = parsed.positional[0];
  const folder = parsed.positional[1];

  if (!agent || !folder) {
    console.error(`Usage: hone ${commandName} <agent> <folder>`);
    console.error("  agent  - Claude agent name (e.g., typescript-craftsperson)");
    console.error("  folder - Project folder to assess");
    process.exit(1);
  }

  const resolvedFolder = resolve(folder);
  const localAgentsDir = join(resolvedFolder, ".claude", "agents");

  await validateAgentOrExit(agent, localAgentsDir);

  return { agent, resolvedFolder };
}
