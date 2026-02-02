import { join } from "path";
import { readFile } from "fs/promises";
import type { CharterCheckResult, CharterSource } from "./types.ts";

async function readFileContent(path: string): Promise<string | null> {
  try {
    const file = Bun.file(path);
    if (await file.exists()) {
      return await file.text();
    }
  } catch {
    // File not readable
  }
  return null;
}

function extractCharterSection(claudeMd: string): string | null {
  const marker = "## Project Charter";
  const idx = claudeMd.indexOf(marker);
  if (idx === -1) return null;

  // Extract from marker to the next ## heading or end of file
  const rest = claudeMd.slice(idx + marker.length);
  const nextHeading = rest.search(/\n## /);
  const section = nextHeading >= 0 ? rest.slice(0, nextHeading) : rest;
  return section.trim();
}

async function readPackageDescription(projectDir: string): Promise<string | null> {
  // package.json
  const pkgContent = await readFileContent(join(projectDir, "package.json"));
  if (pkgContent) {
    try {
      const pkg = JSON.parse(pkgContent);
      if (typeof pkg.description === "string" && pkg.description.length > 0) {
        return pkg.description;
      }
    } catch {
      // Invalid JSON
    }
  }

  // mix.exs — look for @moduledoc or description in project/0
  const mixContent = await readFileContent(join(projectDir, "mix.exs"));
  if (mixContent) {
    const descMatch = mixContent.match(/description:\s*"([^"]+)"/);
    if (descMatch?.[1]) return descMatch[1];
  }

  // pyproject.toml — look for description field
  const pyContent = await readFileContent(join(projectDir, "pyproject.toml"));
  if (pyContent) {
    const descMatch = pyContent.match(/description\s*=\s*"([^"]+)"/);
    if (descMatch?.[1]) return descMatch[1];
  }

  return null;
}

export async function checkCharter(
  projectDir: string,
  minLength: number,
): Promise<CharterCheckResult> {
  const sources: CharterSource[] = [];
  const guidance: string[] = [];

  // 1. CHARTER.md
  const charterContent = await readFileContent(join(projectDir, "CHARTER.md"));
  if (charterContent !== null) {
    const length = charterContent.trim().length;
    sources.push({ file: "CHARTER.md", length, sufficient: length >= minLength });
  }

  // 2. CLAUDE.md — look for Project Charter section
  const claudeContent = await readFileContent(join(projectDir, "CLAUDE.md"));
  if (claudeContent !== null) {
    const section = extractCharterSection(claudeContent);
    if (section !== null) {
      const length = section.length;
      sources.push({ file: "CLAUDE.md (Project Charter section)", length, sufficient: length >= minLength });
    }
  }

  // 3. README.md
  const readmeContent = await readFileContent(join(projectDir, "README.md"));
  if (readmeContent !== null) {
    const length = readmeContent.trim().length;
    sources.push({ file: "README.md", length, sufficient: length >= minLength });
  }

  // 4. Package manager description
  const pkgDesc = await readPackageDescription(projectDir);
  if (pkgDesc !== null) {
    const length = pkgDesc.length;
    sources.push({ file: "package description", length, sufficient: length >= minLength });
  }

  const passed = sources.some((s) => s.sufficient);

  if (!passed) {
    if (sources.length === 0) {
      guidance.push(
        `Add a CHARTER.md describing the project's goals and non-goals`,
        `Add a README.md with a project purpose statement (at least ${minLength} characters)`,
      );
    } else {
      guidance.push(
        `Existing intent documentation is too short (minimum ${minLength} characters required)`,
        `Expand your CHARTER.md, README.md, or add a CLAUDE.md with a ## Project Charter section`,
      );
    }
  }

  return { passed, sources, guidance };
}
