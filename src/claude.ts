import type { ClaudeInvoker } from "./types.ts";

export interface ClaudeStageArgs {
  agent?: string;
  model: string;
  prompt: string;
  readOnly: boolean;
  readOnlyTools: string;
}

export function buildClaudeArgs(opts: ClaudeStageArgs): string[] {
  const args: string[] = [];

  if (opts.agent) {
    args.push("--agent", opts.agent);
  }

  args.push(
    "--model", opts.model,
    "--print",
    "-p", opts.prompt,
  );

  if (opts.readOnly) {
    args.push("--allowedTools", opts.readOnlyTools);
  }

  args.push("--dangerously-skip-permissions");

  return args;
}

export async function invokeClaude(args: string[]): Promise<string> {
  const proc = Bun.spawn(["claude", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`claude exited with code ${exitCode}: ${stderr || stdout}`);
  }

  return stdout.trim();
}

export function createClaudeInvoker(): ClaudeInvoker {
  return invokeClaude;
}
