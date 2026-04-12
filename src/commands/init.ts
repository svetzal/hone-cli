import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
// Embed skill files at build time via Bun text imports
// Source of truth lives in skills/ — .claude/skills/ is the installed copy
import HONE_SKILL_MD from "../../skills/hone/SKILL.md" with { type: "text" };
import { VERSION } from "../constants.ts";
import { CliError } from "../errors.ts";
import { writeJson } from "../output.ts";

interface SkillFile {
  relativePath: string;
  content: string;
}

const SKILL_FILES: SkillFile[] = [{ relativePath: ".claude/skills/hone/SKILL.md", content: HONE_SKILL_MD }];

type FileAction = "created" | "updated" | "up-to-date" | "skipped";

interface FileResult {
  path: string;
  action: FileAction;
  message?: string;
}

interface InitResult {
  success: boolean;
  message: string;
  version: string;
  files: FileResult[];
}

export function stampVersion(content: string): string {
  const closingIndex = content.indexOf("\n---", 1);
  if (closingIndex === -1) return content;
  let stamped = `${content.slice(0, closingIndex)}\nhone-version: ${VERSION}${content.slice(closingIndex)}`;
  // Also stamp metadata.version to match the running binary
  stamped = stamped.replace(/(metadata:\n\s+version:\s*)"[^"]*"/, `$1"${VERSION}"`);
  return stamped;
}

export function parseInstalledVersion(content: string): string | null {
  const match = content.match(/\nhone-version:\s*(.+)/);
  return match ? (match[1]?.trim() ?? null) : null;
}

export function stripVersionField(content: string): string {
  return content.replace(/\nhone-version: .+/g, "").replace(/(metadata:\n\s+version:\s*)"[^"]*"/, '$1"0.0.0"');
}

export function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] ?? 0;
    const numB = partsB[i] ?? 0;
    if (numA < numB) return -1;
    if (numA > numB) return 1;
  }
  return 0;
}

export async function initCommand(parsed: { flags: Record<string, string | boolean> }): Promise<void> {
  const isJson = parsed.flags.json === true;
  const isGlobal = parsed.flags.global === true;
  const isForce = parsed.flags.force === true;
  const baseDir = isGlobal ? join(homedir(), ".claude") : process.cwd();
  const results: FileResult[] = [];

  for (const file of SKILL_FILES) {
    const relPath = isGlobal ? file.relativePath.replace(/^\.claude\//, "") : file.relativePath;
    const fullPath = join(baseDir, relPath);
    const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
    const stamped = stampVersion(file.content);

    let action: FileAction;
    let message: string | undefined;
    const fileRef = Bun.file(fullPath);

    if (!(await fileRef.exists())) {
      await mkdir(dir, { recursive: true });
      await Bun.write(fullPath, stamped);
      action = "created";
    } else {
      const existing = await fileRef.text();
      const installedVersion = parseInstalledVersion(existing);

      // Version guard: refuse if installed version is newer than running binary
      if (installedVersion && !isForce && compareVersions(installedVersion, VERSION) > 0) {
        action = "skipped";
        message = `Installed skill is from hone v${installedVersion} but this binary is v${VERSION}. Use --force to downgrade.`;
        results.push({ path: relPath, action, message });
        continue;
      }

      const existingBody = stripVersionField(existing);
      const newBody = stripVersionField(file.content);

      if (existingBody === newBody) {
        if (existing !== stamped) {
          await Bun.write(fullPath, stamped);
        }
        action = "up-to-date";
      } else {
        await Bun.write(fullPath, stamped);
        action = "updated";
      }
    }

    results.push({ path: relPath, action, message });
  }

  const created = results.filter((r) => r.action === "created").length;
  const updated = results.filter((r) => r.action === "updated").length;
  const upToDate = results.filter((r) => r.action === "up-to-date").length;
  const skipped = results.filter((r) => r.action === "skipped").length;

  const parts: string[] = [];
  if (created > 0) parts.push(`${created} created`);
  if (updated > 0) parts.push(`${updated} updated`);
  if (upToDate > 0) parts.push(`${upToDate} up to date`);
  if (skipped > 0) parts.push(`${skipped} skipped`);
  const summary = parts.join(", ");

  if (isJson) {
    const output: InitResult = {
      success: skipped === 0,
      message: `Skill files installed: ${summary}`,
      version: VERSION,
      files: results,
    };
    writeJson(output);
  } else {
    const scope = isGlobal ? "global (~/.claude)" : "local";
    console.log(`\nHone v${VERSION} — skill files (${scope})\n`);
    for (const r of results) {
      const icon = r.action === "created" ? "+" : r.action === "updated" ? "~" : r.action === "skipped" ? "!" : "=";
      const label =
        r.action === "created"
          ? "Created"
          : r.action === "updated"
            ? "Updated"
            : r.action === "skipped"
              ? "Skipped"
              : "Up to date";
      console.log(`  ${icon} ${r.path} (${label})`);
      if (r.message) {
        console.log(`    ${r.message}`);
      }
    }
    console.log(`\n${summary}`);
  }

  if (skipped > 0) {
    throw new CliError("");
  }
}
