import { join, basename } from "path";
import { readdir } from "fs/promises";
import { buildClaudeArgs } from "./claude.ts";
import { extractGatesFromAgentContent } from "./extract-gates.ts";
import type { ClaudeInvoker, GateDefinition } from "./types.ts";

export interface ProjectContext {
  directoryTree: string;
  packageFiles: Record<string, string>;
  ciConfigs: Record<string, string>;
  toolConfigs: Record<string, string>;
  shellScripts: Record<string, string>;
}

export interface DeriveResult {
  agentContent: string;
  agentName: string;
  gates: GateDefinition[];
}

const PACKAGE_FILES = [
  "package.json",
  "mix.exs",
  "pyproject.toml",
  "Cargo.toml",
  "CMakeLists.txt",
  "go.mod",
  "Gemfile",
  "build.gradle",
  "pom.xml",
];

const CI_PATTERNS = [
  ".github/workflows",
  ".gitlab-ci.yml",
  ".circleci/config.yml",
  "Jenkinsfile",
];

const TOOL_CONFIG_FILES = [
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.json",
  "eslint.config.js",
  "eslint.config.mjs",
  ".prettierrc",
  ".prettierrc.json",
  "prettier.config.js",
  "biome.json",
  ".credo.exs",
  ".formatter.exs",
  "ruff.toml",
  "pyproject.toml",
  ".rubocop.yml",
  "rustfmt.toml",
  ".clang-format",
  "tsconfig.json",
  "deno.json",
  "bunfig.toml",
];

const MAX_FILE_SIZE = 10_000; // Cap individual file reads

async function readFileCapped(path: string): Promise<string | null> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    const stat = await file.stat();
    if (!stat || stat.size > MAX_FILE_SIZE) {
      return `(file too large: ${stat?.size ?? "unknown"} bytes, truncated)`;
    }
    return await file.text();
  } catch {
    return null;
  }
}

async function listDirectoryTree(dir: string, depth: number = 3, prefix: string = ""): Promise<string> {
  const lines: string[] = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const filtered = entries
      .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules" && e.name !== "_build" && e.name !== "deps" && e.name !== "__pycache__" && e.name !== "target" && e.name !== "dist" && e.name !== "build")
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of filtered) {
      if (entry.isDirectory()) {
        lines.push(`${prefix}${entry.name}/`);
        if (depth > 1) {
          const subtree = await listDirectoryTree(join(dir, entry.name), depth - 1, prefix + "  ");
          if (subtree) lines.push(subtree);
        }
      } else {
        lines.push(`${prefix}${entry.name}`);
      }
    }
  } catch {
    // Directory not readable
  }

  return lines.join("\n");
}

export async function gatherContext(folder: string): Promise<ProjectContext> {
  const directoryTree = await listDirectoryTree(folder);

  const packageFiles: Record<string, string> = {};
  for (const file of PACKAGE_FILES) {
    const content = await readFileCapped(join(folder, file));
    if (content) packageFiles[file] = content;
  }

  const ciConfigs: Record<string, string> = {};
  for (const pattern of CI_PATTERNS) {
    const fullPath = join(folder, pattern);
    const file = Bun.file(fullPath);

    try {
      const stat = await file.stat();
      if (stat && !stat.isDirectory()) {
        const content = await readFileCapped(fullPath);
        if (content) ciConfigs[pattern] = content;
      } else if (stat?.isDirectory()) {
        // Read workflow files in directory
        const entries = await readdir(fullPath);
        for (const entry of entries.slice(0, 5)) {
          const content = await readFileCapped(join(fullPath, entry));
          if (content) ciConfigs[`${pattern}/${entry}`] = content;
        }
      }
    } catch {
      // Not found
    }
  }

  const toolConfigs: Record<string, string> = {};
  for (const file of TOOL_CONFIG_FILES) {
    if (packageFiles[file]) continue; // Already captured
    const content = await readFileCapped(join(folder, file));
    if (content) toolConfigs[file] = content;
  }

  // Read shell scripts at project root for build/test command discovery
  const shellScripts: Record<string, string> = {};
  try {
    const rootEntries = await readdir(folder, { withFileTypes: true });
    for (const entry of rootEntries) {
      if (!entry.isDirectory() && entry.name.endsWith(".sh")) {
        const content = await readFileCapped(join(folder, entry.name));
        if (content) shellScripts[entry.name] = content;
      }
    }
  } catch {
    // Directory not readable
  }

  return { directoryTree, packageFiles, ciConfigs, toolConfigs, shellScripts };
}

function buildDerivePrompt(context: ProjectContext): string {
  const sections: string[] = [
    "You are inspecting a software project to generate a Claude agent definition file for it.",
    "Based on the project structure, dependencies, and tooling below, create an agent that:",
    "1. Defines engineering principles appropriate for this project's tech stack",
    "2. Includes a quality assessment prompt structure",
    "3. Specifies mandatory QA checkpoints (test, lint, security commands)",
    "",
    "## Project Structure",
    "```",
    context.directoryTree || "(empty)",
    "```",
  ];

  if (Object.keys(context.packageFiles).length > 0) {
    sections.push("", "## Package/Build Files");
    for (const [name, content] of Object.entries(context.packageFiles)) {
      sections.push(`### ${name}`, "```", content, "```");
    }
  }

  if (Object.keys(context.ciConfigs).length > 0) {
    sections.push("", "## CI Configuration");
    for (const [name, content] of Object.entries(context.ciConfigs)) {
      sections.push(`### ${name}`, "```", content, "```");
    }
  }

  if (Object.keys(context.toolConfigs).length > 0) {
    sections.push("", "## Tool Configurations");
    for (const [name, content] of Object.entries(context.toolConfigs)) {
      sections.push(`### ${name}`, "```", content, "```");
    }
  }

  if (Object.keys(context.shellScripts).length > 0) {
    sections.push("", "## Shell Scripts (project root)");
    for (const [name, content] of Object.entries(context.shellScripts)) {
      sections.push(`### ${name}`, "```bash", content, "```");
    }
  }

  sections.push(
    "",
    "## Agent Naming Convention",
    "The agent name MUST follow the pattern: <primary-technology>-craftsperson",
    "Examples: typescript-craftsperson, python-craftsperson, elixir-phoenix-craftsperson, cpp-qt-craftsperson",
    "Pick the name based on the project's primary technology stack. If the project uses a framework (e.g., Phoenix, Qt, React), include it: elixir-phoenix-craftsperson, cpp-qt-craftsperson.",
    "",
    "## QA Checkpoint Guidelines",
    "For QA checkpoints, you MUST use actual commands and scripts that exist in the project:",
    "- If the project has build/test shell scripts (e.g., build_test.sh, run_tests.sh), use those exact scripts as gate commands (e.g., ./build_test.sh)",
    "- Prefer existing project scripts over inventing commands",
    "- Only suggest commands for tools that are actually configured in the project",
    "- Do NOT hallucinate command names or flags — verify they exist in the project files shown above",
    "",
    "## Output Format",
    "Output a complete agent markdown file. Start with YAML frontmatter containing at minimum:",
    "```yaml",
    "---",
    "name: <primary-technology>-craftsperson",
    "description: <one-line description>",
    "---",
    "```",
    "",
    "Then include sections for:",
    "- Role and expertise description",
    "- Engineering principles (numbered list)",
    "- Quality assessment prompt template",
    "- QA checkpoints with exact commands to run (test, lint, format, security)",
    "",
    "Output ONLY the agent file content, no surrounding explanation.",
  );

  return sections.join("\n");
}

export function extractAgentName(agentContent: string): string {
  // Try YAML frontmatter first
  const frontmatterMatch = agentContent.match(/^---\s*\n([\s\S]*?)\n---/);
  if (frontmatterMatch) {
    const nameMatch = frontmatterMatch[1]!.match(/^name:\s*(.+)$/m);
    if (nameMatch) {
      return nameMatch[1]!.trim().replace(/["']/g, "");
    }
  }

  // Fallback: extract from first heading
  const headingMatch = agentContent.match(/^#\s+(.+)$/m);
  if (headingMatch) {
    return headingMatch[1]!
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  return "derived-agent";
}

export async function derive(
  folder: string,
  model: string,
  gatesModel: string,
  readOnlyTools: string,
  claude: ClaudeInvoker,
): Promise<DeriveResult> {
  const context = await gatherContext(folder);
  const prompt = buildDerivePrompt(context);

  const args = buildClaudeArgs({
    model,
    prompt,
    readOnly: true,
    readOnlyTools,
  });

  const agentContent = await claude(args);
  const agentName = extractAgentName(agentContent);

  // Extract gates from the generated agent content
  const gates = await extractGatesFromAgentContent(agentContent, gatesModel, readOnlyTools, claude);

  return { agentContent, agentName, gates };
}
