import { join } from "path";
import { homedir } from "os";
import { readdir } from "fs/promises";

const AGENTS_DIR = join(homedir(), ".claude", "agents");

export interface AgentInfo {
  name: string;
  file: string;
}

function agentNameFromFile(filename: string): string | null {
  if (filename.endsWith(".agent.md")) {
    return filename.slice(0, -".agent.md".length);
  }
  if (filename.endsWith(".md")) {
    return filename.slice(0, -".md".length);
  }
  return null;
}

export async function listAgents(): Promise<AgentInfo[]> {
  try {
    const files = await readdir(AGENTS_DIR);
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

export async function agentExists(name: string): Promise<boolean> {
  const agents = await listAgents();
  return agents.some((a) => a.name === name);
}
