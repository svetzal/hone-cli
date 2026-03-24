import { resolve } from "path";
import { loadConfig } from "../config.ts";
import { createClaudeInvoker } from "../claude.ts";
import { readAgentContent } from "../agents.ts";
import { deriveGates } from "../derive-gates.ts";
import { runAllGates } from "../gates.ts";
import { parseGatesArgs } from "./gates.ts";
import type { ParsedArgs, GateResult } from "../types.ts";
import { writeJson, progress, reportGateValidation } from "../output.ts";
import { writeGatesFile } from "../gates-file.ts";

export async function deriveGatesCommand(parsed: ParsedArgs): Promise<void> {
  if (parsed.positional.length === 0) {
    console.error("Usage: hone derive-gates [agent] <folder>");
    console.error("  agent  - Optional agent name for context");
    console.error("  folder - Project folder to inspect");
    console.error("");
    console.error("Options:");
    console.error("  --run            Run gates after generating");
    console.error("  --derive-model   Override model (default: from config)");
    process.exit(1);
  }

  const { agentName, folder } = parseGatesArgs(parsed.positional);
  const resolvedFolder = resolve(folder);
  const isJson = parsed.flags.json === true;
  const shouldRun = parsed.flags.run === true;
  const config = await loadConfig();
  const model = typeof parsed.flags["derive-model"] === "string"
    ? parsed.flags["derive-model"]
    : config.models.derive;

  // Optionally load agent content for context
  let agentContent: string | undefined;
  if (agentName) {
    const content = await readAgentContent(agentName);
    if (content) {
      progress(isJson, `Using agent '${agentName}' for context.`);
      agentContent = content;
    } else {
      progress(isJson, `Warning: Agent '${agentName}' not found. Continuing without agent context.`);
    }
  }

  progress(isJson, `Inspecting project at ${resolvedFolder}...`);

  const gates = await deriveGates(
    resolvedFolder,
    model,
    config.readOnlyTools,
    createClaudeInvoker(),
    agentContent,
  );

  // Write .hone-gates.json
  let gatesPath: string | null = null;
  if (gates.length > 0) {
    gatesPath = await writeGatesFile(resolvedFolder, gates);
    progress(isJson, `Gates written to: ${gatesPath}`);
  } else {
    progress(isJson, "No quality gates discovered from project inspection.");
  }

  // Optionally run gates
  let gateValidation: GateResult[] | null = null;
  if (shouldRun && gates.length > 0) {
    progress(isJson, "Running discovered gates...");
    const validationResult = await runAllGates(gates, resolvedFolder, config.gateTimeout);
    gateValidation = validationResult.results;

    reportGateValidation(validationResult.results, validationResult.allPassed, isJson);
  }

  if (isJson) {
    writeJson({
      gates,
      gatesPath,
      agentUsed: agentName ?? null,
      gateValidation,
    });
  } else {
    if (gates.length > 0) {
      console.log(`\nDone. ${gates.length} gate(s) discovered.`);
    } else {
      console.log("\nDone. No gates discovered.");
    }
  }
}
