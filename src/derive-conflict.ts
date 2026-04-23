import { join } from "node:path";
import { agentExists, readAgentContent } from "./agents.ts";
import type { loadConfig } from "./config.ts";
import { suggestExpandedName } from "./derive.ts";
import { CliError } from "./errors.ts";
import { mix } from "./mix.ts";
import { progress, writeJson } from "./output.ts";
import type { ProjectContext } from "./project-context.ts";
import type { PromptFn } from "./prompt.ts";
import type { ClaudeInvoker } from "./types.ts";

export interface ConflictResolution {
  agentName: string;
  agentContent: string;
  skipWrite: boolean;
}

export interface ConflictContext {
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

export async function resolveConflict(ctx: ConflictContext): Promise<ConflictResolution | null> {
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
      const expanded = await suggestExpandedName(ctx.agentName, ctx.context, ctx.existingAgentNames, {
        model: ctx.config.models.triage,
        readOnlyTools: ctx.readOnlyTools,
        claude: ctx.claude,
      });

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
