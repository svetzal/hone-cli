import { resolve, join } from "path";
import { homedir } from "os";
import { mkdir } from "fs/promises";
import { loadConfig } from "../config.ts";
import { createClaudeInvoker } from "../claude.ts";
import { derive } from "../derive.ts";
import type { ParsedArgs } from "../types.ts";

export async function deriveCommand(parsed: ParsedArgs): Promise<void> {
  const folder = parsed.positional[0];

  if (!folder) {
    console.error("Usage: hone derive <folder> [--local | --global]");
    console.error("  folder   - Project folder to inspect");
    console.error("  --local  - Write agent to <folder>/.claude/agents/");
    console.error("  --global - Write agent to ~/.claude/agents/ (default)");
    process.exit(1);
  }

  const resolvedFolder = resolve(folder);
  const isLocal = parsed.flags.local === true;
  const config = await loadConfig();

  console.log(`Inspecting project at ${resolvedFolder}...`);

  const result = await derive(
    resolvedFolder,
    config.models.derive,
    config.models.gates,
    config.readOnlyTools,
    createClaudeInvoker(),
  );

  // Write agent file
  const agentFilename = `${result.agentName}.agent.md`;
  let agentDir: string;

  if (isLocal) {
    agentDir = join(resolvedFolder, ".claude", "agents");
  } else {
    agentDir = join(homedir(), ".claude", "agents");
  }

  await mkdir(agentDir, { recursive: true });
  const agentPath = join(agentDir, agentFilename);
  await Bun.write(agentPath, result.agentContent);
  console.log(`Agent written to: ${agentPath}`);

  // Write .hone-gates.json
  if (result.gates.length > 0) {
    const gatesPath = join(resolvedFolder, ".hone-gates.json");
    await Bun.write(gatesPath, JSON.stringify({ gates: result.gates }, null, 2) + "\n");
    console.log(`Gates written to: ${gatesPath}`);
  } else {
    console.log("No quality gates extracted from agent.");
  }

  console.log(`\nDone. Agent name: ${result.agentName}`);
  console.log(`Run: hone iterate ${result.agentName} ${folder}`);
}
