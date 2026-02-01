import { listAgents } from "../agents.ts";
import type { ParsedArgs } from "../types.ts";

export async function listAgentsCommand(_parsed: ParsedArgs): Promise<void> {
  const agents = await listAgents();

  if (agents.length === 0) {
    console.log("No agents found in ~/.claude/agents/");
    return;
  }

  console.log("Available agents:\n");
  for (const agent of agents) {
    console.log(`  ${agent.name}`);
  }
  console.log(`\n${agents.length} agent(s) found`);
}
