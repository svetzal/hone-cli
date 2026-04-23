import type { ProjectContext } from "./project-context.ts";

/**
 * Renders project context as markdown sections for LLM prompts.
 * Single source of truth for "how project discovery looks in a prompt."
 */
export function renderProjectContextSections(folder: string, context: ProjectContext): string[] {
  const sections: string[] = [
    "## Project Location",
    "",
    `The project is at: ${folder}`,
    "",
    "## Project Structure",
    "```",
    context.directoryTree || "(empty)",
    "```",
  ];

  if (context.packageFiles.length > 0) {
    sections.push("", "## Package/Build Files Found", ...context.packageFiles.map((f) => `- ${f}`));
  }

  if (context.ciConfigs.length > 0) {
    sections.push("", "## CI Configuration Files Found", ...context.ciConfigs.map((f) => `- ${f}`));
  }

  if (context.toolConfigs.length > 0) {
    sections.push("", "## Tool Configuration Files Found", ...context.toolConfigs.map((f) => `- ${f}`));
  }

  if (context.shellScripts.length > 0) {
    sections.push("", "## Shell Scripts Found (project root)", ...context.shellScripts.map((f) => `- ${f}`));
  }

  if (context.lockfiles.length > 0) {
    sections.push("", "## Lockfiles Detected", ...context.lockfiles.map((l) => `- ${l.file} (${l.packageManager})`));
  }

  return sections;
}
