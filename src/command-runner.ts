import { runProcess } from "./process.ts";
import type { CommandRunner } from "./types.ts";

export function createCommandRunner(): CommandRunner {
  return async (command, args, opts) => {
    const { stdout, stderr, exitCode } = await runProcess([command, ...args], { cwd: opts?.cwd });

    return { stdout: (stdout + stderr).trim(), exitCode };
  };
}
