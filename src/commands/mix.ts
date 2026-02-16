import { resolve, join } from "path";
import { homedir } from "os";
import { loadConfig } from "../config.ts";
import { createClaudeInvoker } from "../claude.ts";
import { readAgentContent } from "../agents.ts";
import { mix } from "../mix.ts";
import type { ParsedArgs } from "../types.ts";
import { writeJson, progress } from "../output.ts";

export async function mixCommand(parsed: ParsedArgs): Promise<void> {
  const agentName = parsed.positional[0];
  const folder = parsed.positional[1];
  const foreignName = typeof parsed.flags.from === "string" ? parsed.flags.from : undefined;
  const mixPrinciples = parsed.flags.principles === true;
  const mixGates = parsed.flags.gates === true;
  const isJson = parsed.flags.json === true;

  if (!agentName || !folder || !foreignName) {
    console.error("Usage: hone mix <agent> <folder> --from <foreign-agent> [--principles] [--gates]");
    console.error("  agent           - Local agent name (from <folder>/.claude/agents/)");
    console.error("  folder          - Project directory");
    console.error("  --from <name>   - Foreign agent name (from ~/.claude/agents/)");
    console.error("  --principles    - Mix engineering principles");
    console.error("  --gates         - Mix quality gates / QA checkpoints");
    console.error("  --json          - Output machine-readable JSON");
    process.exit(1);
  }

  if (!mixPrinciples && !mixGates) {
    console.error("Error: At least one of --principles or --gates is required.");
    process.exit(1);
  }

  const resolvedFolder = resolve(folder);
  const localAgentsDir = join(resolvedFolder, ".claude", "agents");
  const globalAgentsDir = join(homedir(), ".claude", "agents");

  // Resolve agent path upfront for validation and to pass to mix()
  const localAgents = await import("../agents.ts").then((m) => m.listAgents(localAgentsDir));
  const agentInfo = localAgents.find((a) => a.name === agentName);
  if (!agentInfo) {
    console.error(`Error: Local agent "${agentName}" not found in ${localAgentsDir}`);
    process.exit(1);
  }
  const agentPath = join(localAgentsDir, agentInfo.file);

  const foreignContent = await readAgentContent(foreignName, globalAgentsDir);
  if (!foreignContent) {
    console.error(`Error: Foreign agent "${foreignName}" not found in ${globalAgentsDir}`);
    process.exit(1);
  }

  const config = await loadConfig();
  const aspects = [mixPrinciples && "principles", mixGates && "gates"].filter(Boolean).join(" + ");
  progress(isJson, `Mixing ${aspects} from "${foreignName}" into "${agentName}"...`);

  const readFile = (p: string) => Bun.file(p).text();
  const result = await mix(
    {
      agentPath,
      foreignAgentContent: foreignContent,
      mixPrinciples,
      mixGates,
      model: config.models.mix,
      gatesModel: config.models.gates,
      readOnlyTools: config.readOnlyTools,
    },
    createClaudeInvoker(),
    readFile,
  );

  // Claude already edited the agent file directly — no write needed
  progress(isJson, `Agent updated: ${agentPath}`);

  // Write gates only when extraction succeeded (gates is an array, possibly empty).
  // When extraction failed (gates is null), leave existing gate file untouched.
  let gatesPath: string | null = null;
  if (result.gatesMixed && result.gates !== null) {
    gatesPath = join(resolvedFolder, ".hone-gates.json");
    await Bun.write(gatesPath, JSON.stringify({ gates: result.gates }, null, 2) + "\n");
    progress(isJson, `Gates written to: ${gatesPath} (${result.gates.length} gate${result.gates.length === 1 ? "" : "s"})`);
  } else if (result.gatesMixed && result.gates === null) {
    progress(isJson, "Warning: Gate extraction failed. Existing .hone-gates.json left unchanged.");
  }

  if (isJson) {
    writeJson({
      agentName,
      agentPath,
      principlesMixed: result.principlesMixed,
      gatesMixed: result.gatesMixed,
      gates: result.gates,
      gatesPath,
    });
  } else {
    console.log("\nDone.");
  }
}
