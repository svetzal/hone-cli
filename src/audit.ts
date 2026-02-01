import { join } from "path";
import { readdir, mkdir } from "fs/promises";

export async function ensureAuditDir(projectDir: string, auditDirName: string): Promise<string> {
  const auditDir = join(projectDir, auditDirName);
  await mkdir(auditDir, { recursive: true });
  return auditDir;
}

export async function saveStageOutput(
  auditDir: string,
  name: string,
  suffix: string,
  content: string,
): Promise<string> {
  const filename = suffix ? `${name}-${suffix}.md` : `${name}.md`;
  const filepath = join(auditDir, filename);
  await Bun.write(filepath, content);
  return filepath;
}

export interface IterationEntry {
  name: string;
  files: string[];
  date: Date;
}

export async function listIterations(auditDir: string): Promise<IterationEntry[]> {
  try {
    const files = await readdir(auditDir);
    const mdFiles = files.filter((f) => f.endsWith(".md")).sort();

    // Group by base name (strip -plan, -actions, -retry-N-actions suffixes)
    const groups = new Map<string, string[]>();

    for (const file of mdFiles) {
      const base = file
        .replace(/-retry-\d+-actions\.md$/, "")
        .replace(/-actions\.md$/, "")
        .replace(/-plan\.md$/, "")
        .replace(/\.md$/, "");

      const group = groups.get(base) ?? [];
      group.push(file);
      groups.set(base, group);
    }

    const entries: IterationEntry[] = [];
    for (const [name, groupFiles] of groups) {
      // Use the first file's mtime as the iteration date
      const stat = await Bun.file(join(auditDir, groupFiles[0]!)).stat();
      entries.push({
        name,
        files: groupFiles,
        date: stat ? new Date(stat.mtime) : new Date(),
      });
    }

    return entries.sort((a, b) => b.date.getTime() - a.date.getTime());
  } catch {
    return [];
  }
}
