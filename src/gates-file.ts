import { join } from "node:path";
import type { GateDefinition } from "./types.ts";

const GATES_FILENAME = ".hone-gates.json";

export function gatesFilePath(projectDir: string): string {
  return join(projectDir, GATES_FILENAME);
}

export async function writeGatesFile(projectDir: string, gates: GateDefinition[]): Promise<string> {
  const path = gatesFilePath(projectDir);
  await Bun.write(path, `${JSON.stringify({ gates }, null, 2)}\n`);
  return path;
}

export function validateGateArray(parsed: unknown): GateDefinition[] {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return [];

  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.gates)) return [];

  return obj.gates
    .filter(
      (g): g is Record<string, unknown> =>
        typeof g === "object" &&
        g !== null &&
        typeof (g as Record<string, unknown>).name === "string" &&
        typeof (g as Record<string, unknown>).command === "string",
    )
    .map((g) => ({
      name: g.name as string,
      command: g.command as string,
      required: typeof g.required === "boolean" ? g.required : true,
      ...(typeof g.timeout === "number" && { timeout: g.timeout }),
    }));
}

export async function readGatesFile(projectDir: string): Promise<GateDefinition[] | null> {
  const filePath = gatesFilePath(projectDir);
  const file = Bun.file(filePath);

  try {
    if (await file.exists()) {
      const config = await file.json();
      return validateGateArray(config);
    }
  } catch {
    // Invalid JSON or read error — fall through
  }

  return null;
}
