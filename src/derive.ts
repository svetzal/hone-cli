import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { buildClaudeArgs } from "./claude.ts";
import { extractGatesFromAgentContent } from "./extract-gates.ts";
import { renderProjectContextSections } from "./prompt-context.ts";
import type { ClaudeInvoker, GateDefinition } from "./types.ts";

export interface LockfileInfo {
  file: string;
  packageManager: string;
}

export interface ProjectContext {
  directoryTree: string;
  packageFiles: string[];
  ciConfigs: string[];
  toolConfigs: string[];
  shellScripts: string[];
  lockfiles: LockfileInfo[];
}

export interface DeriveResult {
  agentContent: string;
  agentName: string;
  gates: GateDefinition[];
  context: ProjectContext;
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

const CI_PATTERNS = [".github/workflows", ".gitlab-ci.yml", ".circleci/config.yml", "Jenkinsfile"];

const LOCKFILE_MAP: Record<string, string> = {
  "bun.lockb": "bun",
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn",
  "package-lock.json": "npm",
  "uv.lock": "uv",
  "poetry.lock": "poetry",
  "Pipfile.lock": "pipenv",
  "Cargo.lock": "cargo",
  "go.sum": "go",
  "Gemfile.lock": "bundler",
};

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

async function listDirectoryTree(dir: string, depth: number = 3, prefix: string = ""): Promise<string> {
  const lines: string[] = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const filtered = entries
      .filter(
        (e) =>
          !e.name.startsWith(".") &&
          e.name !== "node_modules" &&
          e.name !== "_build" &&
          e.name !== "deps" &&
          e.name !== "__pycache__" &&
          e.name !== "target" &&
          e.name !== "dist" &&
          e.name !== "build",
      )
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of filtered) {
      if (entry.isDirectory()) {
        lines.push(`${prefix}${entry.name}/`);
        if (depth > 1) {
          const subtree = await listDirectoryTree(join(dir, entry.name), depth - 1, `${prefix}  `);
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

  const packageFiles: string[] = [];
  for (const file of PACKAGE_FILES) {
    const f = Bun.file(join(folder, file));
    try {
      if (await f.exists()) packageFiles.push(file);
    } catch {
      // Not readable
    }
  }

  const ciConfigs: string[] = [];
  for (const pattern of CI_PATTERNS) {
    const fullPath = join(folder, pattern);
    const f = Bun.file(fullPath);
    try {
      const stat = await f.stat();
      if (stat && !stat.isDirectory()) {
        ciConfigs.push(pattern);
      } else if (stat?.isDirectory()) {
        const entries = await readdir(fullPath);
        for (const entry of entries.slice(0, 5)) {
          ciConfigs.push(`${pattern}/${entry}`);
        }
      }
    } catch {
      // Not found
    }
  }

  const toolConfigs: string[] = [];
  for (const file of TOOL_CONFIG_FILES) {
    if (packageFiles.includes(file)) continue; // Already captured
    const f = Bun.file(join(folder, file));
    try {
      if (await f.exists()) toolConfigs.push(file);
    } catch {
      // Not readable
    }
  }

  const lockfiles: LockfileInfo[] = [];
  for (const [file, packageManager] of Object.entries(LOCKFILE_MAP)) {
    const f = Bun.file(join(folder, file));
    try {
      if (await f.exists()) lockfiles.push({ file, packageManager });
    } catch {
      // Not readable
    }
  }

  const shellScripts: string[] = [];
  try {
    const rootEntries = await readdir(folder, { withFileTypes: true });
    for (const entry of rootEntries) {
      if (!entry.isDirectory() && entry.name.endsWith(".sh")) {
        shellScripts.push(entry.name);
      }
    }
  } catch {
    // Directory not readable
  }

  return { directoryTree, packageFiles, ciConfigs, toolConfigs, shellScripts, lockfiles };
}

export function buildDerivePrompt(folder: string, context: ProjectContext, existingAgentNames: string[] = []): string {
  const sections: string[] = [
    "You are creating a custom craftsperson agent for a software project.",
    "You have Read, Glob, and Grep tools available. Use them to explore the project",
    "and understand its architecture, conventions, patterns, and tooling before writing the agent.",
    "",
    ...renderProjectContextSections(folder, context),
  ];

  if (existingAgentNames.length > 0) {
    sections.push(
      "",
      "## Existing Agent Names (avoid collisions)",
      "",
      "The following agent names already exist. Choose a name that does NOT conflict with any of these:",
      ...existingAgentNames.map((n) => `- ${n}`),
    );
  }

  sections.push(
    "",
    "## Exploration Instructions",
    "",
    "Before writing the agent, explore the project using your tools:",
    "",
    "1. **Read package/build files** to identify the tech stack, dependencies, and existing scripts",
    "2. **Read CI configuration files** to discover existing test, lint, and build commands",
    "3. **Read tool configuration files** to understand linter rules, formatter settings, and compiler options",
    "4. **Use Glob** to find source files (e.g., `src/**/*.ts`, `lib/**/*.ex`, `src/**/*.py`)",
    "5. **Read 3-5 representative source files** to identify coding patterns, naming conventions, error handling idioms, and architectural patterns",
    "6. **Use Grep** to search for architecture signals: dependency injection patterns, module structure, test organization, error handling patterns",
    "",
    "## Agent Output Structure",
    "",
    "Write the agent with these sections, informed by what you discover in the code:",
    "",
    "### Required Sections",
    "",
    "1. **YAML Frontmatter** — `name` and `description` fields",
    "2. **Core Identity** — Role, expertise, what this agent specializes in",
    "3. **Engineering Principles** — Numbered list of principles derived from the project's actual patterns and needs",
    "4. **Quality Assurance Process** — Assessment prompt template and QA checkpoints with exact commands",
    "5. **Architecture** — The project's actual architecture, module organization, and key patterns found in the code",
    "6. **Language/Framework Guidelines** — Conventions observed in the codebase (naming, error handling, testing idioms)",
    "7. **Tool Stack** — Actual tools configured in the project with their specific configurations",
    "8. **Anti-Patterns** — Things to avoid, based on what you see in the project",
    "9. **Self-Correction** — How the agent should respond when quality gates fail",
    "10. **Escalation** — When to stop and ask for human input",
    "",
    "## Agent Naming Convention",
    "",
    "The agent name MUST follow the pattern: `<runtime-or-pkg-manager>-<language>-<framework>-craftsperson`",
    "Include segments that distinguish this project's toolchain:",
    "- Include the runtime or package manager when distinctive (bun, uv, poetry, pnpm, cargo)",
    "- Include the primary language (typescript, python, elixir, rust, cpp)",
    "- Include the framework when present (react, fastapi, django, phoenix, qt)",
    "- Omit segments that aren't distinctive or don't add clarity",
    "",
    "Examples:",
    "- `bun-typescript-react-craftsperson` — Bun runtime, TypeScript, React framework",
    "- `uv-python-fastapi-craftsperson` — uv package manager, Python, FastAPI",
    "- `poetry-python-django-craftsperson` — Poetry package manager, Python, Django",
    "- `elixir-phoenix-craftsperson` — no special runtime, Elixir with Phoenix",
    "- `bun-typescript-craftsperson` — Bun runtime, TypeScript, no framework",
    "- `rust-craftsperson` — plain Rust with no distinctive runtime or framework",
    "",
    "Fall back to `<language>-craftsperson` only when no distinctive runtime, package manager, or framework is detected.",
    "",
    "## QA Checkpoint Rules",
    "",
    "- Use ONLY exact commands found in package scripts, CI configs, or shell scripts",
    "- Do NOT invent or guess commands — every command must come from a file you read",
    "- If the project has build/test shell scripts, use those exact scripts as gate commands",
    "- Security gates (audit commands) should be marked as `required: false`",
    "- Prefer existing project scripts over constructing commands",
    "",
    "## Output Format",
    "",
    "Output a complete agent markdown file. Start with YAML frontmatter:",
    "```yaml",
    "---",
    "name: <runtime-language-framework>-craftsperson",
    "description: <one-line description>",
    "---",
    "```",
    "",
    "Output ONLY the agent file content, no surrounding explanation.",
  );

  return sections.join("\n");
}

export function extractAgentName(agentContent: string): string {
  // Try YAML frontmatter first
  const frontmatterMatch = agentContent.match(/^---\s*\n([\s\S]*?)\n---/);
  if (frontmatterMatch) {
    const nameMatch = frontmatterMatch[1]?.match(/^name:\s*(.+)$/m);
    if (nameMatch) {
      return (nameMatch[1] ?? "").trim().replace(/["']/g, "");
    }
  }

  // Fallback: extract from first heading
  const headingMatch = agentContent.match(/^#\s+(.+)$/m);
  if (headingMatch) {
    return (headingMatch[1] ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  return "derived-agent";
}

export async function suggestExpandedName(
  conflictingName: string,
  context: ProjectContext,
  existingNames: string[],
  model: string,
  readOnlyTools: string,
  claude: ClaudeInvoker,
): Promise<string> {
  const signals: string[] = [];
  if (context.lockfiles.length > 0) {
    signals.push(`Lockfiles: ${context.lockfiles.map((l) => `${l.file} (${l.packageManager})`).join(", ")}`);
  }
  if (context.packageFiles.length > 0) {
    signals.push(`Package files: ${context.packageFiles.join(", ")}`);
  }
  if (context.toolConfigs.length > 0) {
    signals.push(`Tool configs: ${context.toolConfigs.join(", ")}`);
  }

  const prompt = `The agent name "${conflictingName}" already exists. Suggest a single more-specific kebab-case agent name ending in "-craftsperson" that distinguishes this project based on its toolchain.

Project signals:
${signals.join("\n")}

Existing agent names (avoid all of these):
${existingNames.map((n) => `- ${n}`).join("\n")}

Output ONLY the new name, nothing else.`;

  const args = buildClaudeArgs({
    model,
    prompt,
    readOnly: true,
    readOnlyTools,
  });

  const raw = await claude(args);
  return raw.trim().replace(/[`"']/g, "");
}

export async function derive(
  folder: string,
  model: string,
  gatesModel: string,
  readOnlyTools: string,
  claude: ClaudeInvoker,
  existingAgentNames: string[] = [],
): Promise<DeriveResult> {
  const context = await gatherContext(folder);
  const prompt = buildDerivePrompt(folder, context, existingAgentNames);

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

  return { agentContent, agentName, gates, context };
}
