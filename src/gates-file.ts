import { join } from "path";
import type { GateDefinition } from "./types.ts";

const GATES_FILENAME = ".hone-gates.json";

export function gatesFilePath(projectDir: string): string {
  return join(projectDir, GATES_FILENAME);
}

export async function writeGatesFile(projectDir: string, gates: GateDefinition[]): Promise<string> {
  const path = gatesFilePath(projectDir);
  await Bun.write(path, JSON.stringify({ gates }, null, 2) + "\n");
  return path;
}

export async function readGatesFile(projectDir: string): Promise<GateDefinition[] | null> {
  const filePath = gatesFilePath(projectDir);
  const file = Bun.file(filePath);

  try {
    if (await file.exists()) {
      const config = await file.json();
      return (config.gates as GateDefinition[]).map((g) => ({
        name: g.name,
        command: g.command,
        required: g.required ?? true,
        ...(g.timeout !== undefined && { timeout: g.timeout }),
      }));
    }
  } catch {
    // Invalid JSON or read error — fall through
  }

  return null;
}
