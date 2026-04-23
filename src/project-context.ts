import { readdir } from "node:fs/promises";
import { join } from "node:path";

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

async function filterExistingFiles(folder: string, files: string[]): Promise<string[]> {
  const results: string[] = [];
  for (const file of files) {
    try {
      if (await Bun.file(join(folder, file)).exists()) results.push(file);
    } catch {
      // Not readable
    }
  }
  return results;
}

export async function gatherContext(folder: string): Promise<ProjectContext> {
  const directoryTree = await listDirectoryTree(folder);

  const packageFiles = await filterExistingFiles(folder, PACKAGE_FILES);

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

  const toolConfigs = await filterExistingFiles(
    folder,
    TOOL_CONFIG_FILES.filter((f) => !packageFiles.includes(f)),
  );

  const lockfileNames = await filterExistingFiles(folder, Object.keys(LOCKFILE_MAP));
  const lockfiles: LockfileInfo[] = lockfileNames.map((file) => ({
    file,
    packageManager: LOCKFILE_MAP[file] as string,
  }));

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
