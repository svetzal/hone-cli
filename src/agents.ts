import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { CliError } from "./errors.ts";

const AGENTS_DIR = join(homedir(), ".claude", "agents");

export interface AgentInfo {
  name: string;
  file: string;
}

export function agentNameFromFile(filename: string): string | null {
  if (filename.endsWith(".agent.md")) {
    return filename.slice(0, -".agent.md".length);
  }
  if (filename.endsWith(".md")) {
    return filename.slice(0, -".md".length);
  }
  return null;
}

export async function listAgents(agentsDir?: string): Promise<AgentInfo[]> {
  const dir = agentsDir ?? AGENTS_DIR;
  try {
    const files = await readdir(dir);
    const agentMap = new Map<string, AgentInfo>();

    for (const file of files) {
      const name = agentNameFromFile(file);
      if (name) {
        const existing = agentMap.get(name);
        if (!existing || (file.endsWith(".md") && !file.endsWith(".agent.md"))) {
          agentMap.set(name, { name, file });
        }
      }
    }

    return Array.from(agentMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export async function agentExists(name: string, agentsDir?: string): Promise<boolean> {
  const agents = await listAgents(agentsDir);
  return agents.some((a) => a.name === name);
}

export async function validateAgent(agent: string, localAgentsDir: string): Promise<void> {
  if (!(await agentExists(agent)) && !(await agentExists(agent, localAgentsDir))) {
    throw new CliError(
      `Agent '${agent}' not found in ~/.claude/agents/ or ${localAgentsDir}/\nRun 'hone list-agents' to see available agents.`,
    );
  }
}

export async function readAgentContent(name: string, agentsDir?: string): Promise<string | null> {
  const dir = agentsDir ?? AGENTS_DIR;
  const agents = await listAgents(agentsDir);
  const agent = agents.find((a) => a.name === name);
  if (!agent) return null;

  try {
    const filePath = join(dir, agent.file);
    const file = Bun.file(filePath);
    return await file.text();
  } catch {
    return null;
  }
}
