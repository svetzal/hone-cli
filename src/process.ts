export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

export interface RunProcessOptions {
  cwd?: string;
  timeout?: number;
  env?: Record<string, string | undefined>;
}

export async function runProcess(command: string[], opts?: RunProcessOptions): Promise<ProcessResult> {
  const proc = Bun.spawn(command, {
    cwd: opts?.cwd,
    env: opts?.env,
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  let timeoutId: Timer | undefined;
  if (opts?.timeout) {
    timeoutId = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, opts.timeout);
  }

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (timeoutId !== undefined) {
    clearTimeout(timeoutId);
  }

  return { stdout, stderr, exitCode, timedOut };
}
