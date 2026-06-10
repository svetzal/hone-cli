import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { agentExists, listAgents } from "./agents.ts";
import { claudeCtxFromConfig } from "./claude.ts";
import type { ResolvedDeriveArgs } from "./commands/resolve-derive-args.ts";
import { validateAndReportGates } from "./commands/validate-and-report-gates.ts";
import { derive } from "./derive.ts";
import { resolveConflict, updateFrontmatterName } from "./derive-conflict.ts";
import { writeGatesFile } from "./gates-file.ts";
import type { PromptFn } from "./prompt.ts";
import type { ClaudeInvoker, DeriveOutcome, GateResult, HoneConfig } from "./types.ts";

export async function runDerive(
  args: ResolvedDeriveArgs,
  deps: { claude: ClaudeInvoker; prompt: PromptFn; config: HoneConfig },
  onProgress: (stage: string, message: string) => void,
): Promise<DeriveOutcome | null> {
  const { resolvedFolder, isGlobal, nameOverride } = args;
  const { claude, prompt, config } = deps;

  const agentDir = isGlobal ? join(homedir(), ".claude", "agents") : join(resolvedFolder, ".claude", "agents");

  const globalAgentsDir = join(homedir(), ".claude", "agents");
  const existingAgents = await listAgents(globalAgentsDir);
  if (!isGlobal) {
    const localAgents = await listAgents(agentDir);
    for (const la of localAgents) {
      if (!existingAgents.some((a) => a.name === la.name)) {
        existingAgents.push(la);
      }
    }
  }
  const existingAgentNames = existingAgents.map((a) => a.name);

  onProgress("derive", `Inspecting project at ${resolvedFolder}...`);

  const result = await derive(
    resolvedFolder,
    claudeCtxFromConfig(config, "derive", claude),
    claudeCtxFromConfig(config, "gates", claude),
    existingAgentNames,
  );

  let agentName = nameOverride ?? result.agentName;
  let agentContent = result.agentContent;

  if (nameOverride) {
    agentContent = updateFrontmatterName(agentContent, nameOverride);
  }

  await mkdir(agentDir, { recursive: true });
  const hasConflict = await agentExists(agentName, agentDir);
  let agentWrite: "written" | "merged" = "written";

  if (hasConflict) {
    const resolved = await resolveConflict({
      agentName,
      agentDir,
      agentContent,
      context: result.context,
      existingAgentNames,
      isJson: args.isJson,
      config,
      claude,
      prompt,
    });

    if (resolved === null) {
      return null;
    }

    agentName = resolved.agentName;
    agentContent = resolved.agentContent;
    if (resolved.skipWrite) {
      agentWrite = "merged";
    }
  }

  const agentPath = join(agentDir, `${agentName}.md`);
  if (agentWrite === "merged") {
    onProgress("derive", `Agent merged into existing: ${agentPath}`);
  } else {
    await Bun.write(agentPath, agentContent);
    onProgress("derive", `Agent written to: ${agentPath}`);
  }

  let gatesPath: string | null = null;
  if (result.gates.length > 0) {
    gatesPath = await writeGatesFile(resolvedFolder, result.gates);
    onProgress("derive", `Gates written to: ${gatesPath}`);
  } else {
    onProgress("derive", "No quality gates extracted from agent.");
  }

  let gateValidation: GateResult[] | null = null;
  if (result.gates.length > 0) {
    gateValidation = await validateAndReportGates(
      result.gates,
      resolvedFolder,
      config.gateTimeout,
      args.isJson,
      "Validating generated gates...",
    );
  }

  return { agentName, agentPath, agentWrite, gates: result.gates, gatesPath, gateValidation };
}
