import { join } from "path";
import { homedir } from "os";
import { readdir } from "fs/promises";

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
    const agents: AgentInfo[] = [];

    for (const file of files) {
      const name = agentNameFromFile(file);
      if (name) {
        agents.push({ name, file });
      }
    }

    return agents.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export async function agentExists(name: string, agentsDir?: string): Promise<boolean> {
  const agents = await listAgents(agentsDir);
  return agents.some((a) => a.name === name);
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
