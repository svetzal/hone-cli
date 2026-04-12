import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { agentExists, listAgents, readAgentContent } from "../agents.ts";
import { createClaudeInvoker } from "../claude.ts";
import { loadConfig } from "../config.ts";
import type { ProjectContext } from "../derive.ts";
import { derive, suggestExpandedName } from "../derive.ts";
import { CliError } from "../errors.ts";
import { runAllGates } from "../gates.ts";
import { writeGatesFile } from "../gates-file.ts";
import { mix } from "../mix.ts";
import { progress, reportGateValidation, writeJson } from "../output.ts";
import type { PromptFn } from "../prompt.ts";
import { promptChoice } from "../prompt.ts";
import type { ClaudeInvoker, GateResult, ParsedArgs } from "../types.ts";

export async function deriveCommand(
  parsed: ParsedArgs,
  deps?: { prompt?: PromptFn; claude?: ClaudeInvoker },
): Promise<void> {
  const folder = parsed.positional[0];

  if (!folder) {
    throw new CliError(
      "Usage: hone derive <folder> [--local | --global] [--name <name>]\n" +
        "  folder   - Project folder to inspect\n" +
        "  --local  - Write agent to <folder>/.claude/agents/ (default)\n" +
        "  --global - Write agent to ~/.claude/agents/\n" +
        "  --name   - Override agent name (skip Claude's naming)",
    );
  }

  const resolvedFolder = resolve(folder);
  const isGlobal = parsed.flags.global === true;
  const isJson = parsed.flags.json === true;
  const nameOverride = typeof parsed.flags.name === "string" ? parsed.flags.name : undefined;
  const config = await loadConfig();
  const claude = deps?.claude ?? createClaudeInvoker();
  const prompt = deps?.prompt ?? promptChoice;

  // Determine target directory
  const agentDir = isGlobal ? join(homedir(), ".claude", "agents") : join(resolvedFolder, ".claude", "agents");

  // Gather existing agent names from both global and target directories
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

  progress(isJson, `Inspecting project at ${resolvedFolder}...`);

  const result = await derive(
    resolvedFolder,
    config.models.derive,
    config.models.gates,
    config.readOnlyTools,
    claude,
    existingAgentNames,
  );

  // Apply --name override if provided
  let agentName = nameOverride ?? result.agentName;
  let agentContent = result.agentContent;

  // If name was overridden, update the frontmatter to match
  if (nameOverride) {
    agentContent = updateFrontmatterName(agentContent, nameOverride);
  }

  // Conflict detection
  await mkdir(agentDir, { recursive: true });
  const hasConflict = await agentExists(agentName, agentDir);
  let skipAgentWrite = false;

  if (hasConflict) {
    const resolved = await resolveConflict({
      agentName,
      agentDir,
      agentContent,
      context: result.context,
      existingAgentNames,
      isJson,
      config,
      claude,
      prompt,
      readOnlyTools: config.readOnlyTools,
    });

    if (resolved === null) {
      progress(isJson, "Aborted.");
      return;
    }

    agentName = resolved.agentName;
    agentContent = resolved.agentContent;
    skipAgentWrite = resolved.skipWrite;
  }

  // Write agent file (unless merge handled it)
  const agentPath = join(agentDir, `${agentName}.md`);
  if (skipAgentWrite) {
    progress(isJson, `Agent merged into existing: ${agentPath}`);
  } else {
    await Bun.write(agentPath, agentContent);
    progress(isJson, `Agent written to: ${agentPath}`);
  }

  // Write .hone-gates.json
  let gatesPath: string | null = null;
  if (result.gates.length > 0) {
    gatesPath = await writeGatesFile(resolvedFolder, result.gates);
    progress(isJson, `Gates written to: ${gatesPath}`);
  } else {
    progress(isJson, "No quality gates extracted from agent.");
  }

  // Validate generated gates
  let gateValidation: GateResult[] | null = null;
  if (result.gates.length > 0) {
    progress(isJson, "Validating generated gates...");
    const validationResult = await runAllGates(result.gates, resolvedFolder, config.gateTimeout);
    gateValidation = validationResult.results;

    reportGateValidation(validationResult.results, validationResult.allPassed, isJson);
  }

  if (isJson) {
    writeJson({
      agentName,
      agentPath,
      gates: result.gates,
      gatesPath,
      gateValidation,
    });
  } else {
    console.log(`\nDone. Agent name: ${agentName}`);
    console.log(`Run: hone iterate ${agentName} ${resolvedFolder}`);
  }
}

interface ConflictResolution {
  agentName: string;
  agentContent: string;
  skipWrite: boolean;
}

interface ConflictContext {
  agentName: string;
  agentDir: string;
  agentContent: string;
  context: ProjectContext;
  existingAgentNames: string[];
  isJson: boolean;
  config: Awaited<ReturnType<typeof loadConfig>>;
  claude: ClaudeInvoker;
  prompt: PromptFn;
  readOnlyTools: string;
}

async function resolveConflict(ctx: ConflictContext): Promise<ConflictResolution | null> {
  if (ctx.isJson) {
    writeJson({
      error: "agent_name_conflict",
      conflictingName: ctx.agentName,
      targetDir: ctx.agentDir,
      suggestedActions: ["overwrite", "expand", "merge", "abort"],
    });
    throw new CliError("");
  }

  // Read existing agent description for context
  const existingContent = await readAgentContent(ctx.agentName, ctx.agentDir);
  const descLine = existingContent?.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "(no description)";

  const choice = await ctx.prompt(
    `Agent "${ctx.agentName}" already exists in ${ctx.agentDir}\n  Description: ${descLine}\n\nHow should this be resolved?`,
    [
      { key: "o", label: "Overwrite existing agent" },
      { key: "e", label: "Expand name (suggest a more specific name)" },
      { key: "m", label: "Merge new principles into existing agent" },
      { key: "a", label: "Abort" },
    ],
  );

  switch (choice) {
    case "o":
      return { agentName: ctx.agentName, agentContent: ctx.agentContent, skipWrite: false };

    case "e": {
      progress(ctx.isJson, "Generating expanded name...");
      const expanded = await suggestExpandedName(
        ctx.agentName,
        ctx.context,
        ctx.existingAgentNames,
        ctx.config.models.triage, // haiku — cheap call
        ctx.readOnlyTools,
        ctx.claude,
      );

      if (await agentExists(expanded, ctx.agentDir)) {
        throw new CliError(`Expanded name "${expanded}" also conflicts. Use --name to specify a name manually.`);
      }

      progress(ctx.isJson, `Using expanded name: ${expanded}`);
      const updatedContent = updateFrontmatterName(ctx.agentContent, expanded);
      return { agentName: expanded, agentContent: updatedContent, skipWrite: false };
    }

    case "m": {
      progress(ctx.isJson, `Merging new principles into existing "${ctx.agentName}"...`);
      const agentPath = join(ctx.agentDir, `${ctx.agentName}.md`);
      const readFile = (p: string) => Bun.file(p).text();
      await mix(
        {
          agentPath,
          foreignAgentContent: ctx.agentContent,
          mixPrinciples: true,
          mixGates: false,
          model: ctx.config.models.mix,
          gatesModel: ctx.config.models.gates,
          readOnlyTools: ctx.readOnlyTools,
        },
        ctx.claude,
        readFile,
      );
      return { agentName: ctx.agentName, agentContent: ctx.agentContent, skipWrite: true };
    }
    default:
      return null;
  }
}

export function updateFrontmatterName(content: string, name: string): string {
  const frontmatterMatch = content.match(/^(---\s*\n)([\s\S]*?)(\n---)/);
  if (frontmatterMatch) {
    const updated = frontmatterMatch[2]?.replace(/^name:\s*.+$/m, `name: ${name}`);
    return `${frontmatterMatch[1]}${updated}${frontmatterMatch[3]}${content.slice(frontmatterMatch[0].length)}`;
  }
  return content;
}
