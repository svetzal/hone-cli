import { join } from "path";
import { extractGatesFromAgent } from "./extract-gates.ts";
import type { ClaudeInvoker, GateDefinition } from "./types.ts";

export async function loadOverrideGates(projectDir: string): Promise<GateDefinition[] | null> {
  const overridePath = join(projectDir, ".hone-gates.json");
  const overrideFile = Bun.file(overridePath);

  try {
    if (await overrideFile.exists()) {
      const config = await overrideFile.json();
      return (config.gates as GateDefinition[]).map((g) => ({
        name: g.name,
        command: g.command,
        required: g.required ?? true,
      }));
    }
  } catch {
    // Invalid JSON or read error — fall through
  }

  return null;
}

export async function resolveGates(
  projectDir: string,
  agentName: string,
  model: string,
  readOnlyTools: string,
  claude: ClaudeInvoker,
): Promise<GateDefinition[]> {
  // Priority 1: .hone-gates.json override
  const override = await loadOverrideGates(projectDir);
  if (override) return override;

  // Priority 2: Extract from agent via Claude
  const extracted = await extractGatesFromAgent(agentName, model, readOnlyTools, claude);
  if (extracted.length > 0) return extracted;

  // Priority 3: No gates
  return [];
}
