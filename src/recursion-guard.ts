const DEPTH_KEY = "HONE_AGENT_DEPTH";

export function nextDepthEnv(parent: NodeJS.ProcessEnv): Record<string, string> {
  const current = parseInt(parent[DEPTH_KEY] ?? "0", 10);
  const next = Number.isNaN(current) ? 1 : current + 1;
  return { ...parent, [DEPTH_KEY]: String(next) } as Record<string, string>;
}

export function assertNotRecursive(command: "iterate" | "maintain"): void {
  const raw = process.env[DEPTH_KEY];
  const depth = parseInt(raw ?? "0", 10);
  if (depth > 0) {
    process.stderr.write(
      `hone ${command} cannot be invoked from inside an existing hone agent context (HONE_AGENT_DEPTH=${depth}). You appear to be a Claude agent already running inside hone — run the underlying gate commands directly using your Bash tool instead of calling hone recursively.\n`,
    );
    process.exit(2);
  }
}
