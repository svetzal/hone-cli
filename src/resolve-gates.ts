import { extractGatesFromAgent } from "./extract-gates.ts";
import { readGatesFile } from "./gates-file.ts";
import type { ClaudeContext, GateDefinition } from "./types.ts";

export async function loadOverrideGates(projectDir: string): Promise<GateDefinition[] | null> {
  return readGatesFile(projectDir);
}

export async function resolveGates(
  projectDir: string,
  agentName: string,
  ctx: ClaudeContext,
): Promise<GateDefinition[]> {
  // Priority 1: .hone-gates.json override
  const override = await loadOverrideGates(projectDir);
  if (override) return override;

  // Priority 2: Extract from agent via Claude
  const extracted = await extractGatesFromAgent(agentName, ctx);
  if (extracted.length > 0) return extracted;

  // Priority 3: No gates
  return [];
}
