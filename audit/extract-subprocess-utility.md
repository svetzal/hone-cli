Now I have a thorough understanding of the entire codebase. Let me compile my assessment.

```json
{ "severity": 3, "principle": "No Knowledge Duplication", "category": "architecture" }
```

## Assessment: Knowledge Duplication in Subprocess Spawning and Output Capture

### Overview

This is a well-engineered codebase. The separation of concerns is clean, the dependency injection pattern enables excellent testability, the type system is used thoughtfully, and test coverage is comprehensive. The charter/triage containment strategy is architecturally sound. Credit where it's due — this project demonstrates clear thinking and disciplined execution.

That said, the most violated principle I can identify is **No Knowledge Duplication** — specifically, the subprocess spawning and output capture pattern is duplicated across three independent locations, each representing the **same decision** about how to run an external process and collect its results.

### Where the Duplication Lives

Three separate files implement essentially identical subprocess execution logic:

**1. `src/claude.ts` — `invokeClaude()` (lines 33–48)**
```typescript
const proc = Bun.spawn(["claude", ...args], {
  stdout: "pipe",
  stderr: "pipe",
});
const stdout = await new Response(proc.stdout).text();
const stderr = await new Response(proc.stderr).text();
const exitCode = await proc.exited;
```

**2. `src/github.ts` — `createCommandRunner()` (lines 240–254)**
```typescript
const proc = Bun.spawn([command, ...args], {
  cwd: opts?.cwd,
  stdout: "pipe",
  stderr: "pipe",
});
const stdout = await new Response(proc.stdout).text();
const stderr = await new Response(proc.stderr).text();
const exitCode = await proc.exited;
```

**3. `src/gates.ts` — `runGate()` (lines 17–52)**
```typescript
const proc = Bun.spawn(["sh", "-c", gate.command], {
  cwd: projectDir,
  stdout: "pipe",
  stderr: "pipe",
});
const stdout = await new Response(proc.stdout).text();
const stderr = await new Response(proc.stderr).text();
const exitCode = await proc.exited;
```

All three follow the same pattern:
1. `Bun.spawn()` with stdout/stderr piped
2. `new Response(proc.stdout).text()` / `new Response(proc.stderr).text()`
3. `await proc.exited` for exit code
4. Combine or return stdout + stderr

This is **knowledge duplication** — if Bun changes its subprocess API, or if you need to adjust how output is captured (e.g., streaming, size limits, encoding), you'd need to change three places for the same reason. They're not independent decisions that might diverge; they're the same decision about "how this tool runs external processes."

### Why This Matters (Severity 3)

This isn't critical — the codebase works correctly and the duplication is manageable at three instances. But it creates a subtle maintenance burden:

- `gates.ts` has timeout handling (`setTimeout + proc.kill`) that the other two don't. Should they? If a `claude` call hangs forever, there's no timeout protection.
- `github.ts` merges stdout + stderr into a single string; `claude.ts` keeps them separate for error reporting; `gates.ts` concatenates them with a newline. These are three different decisions about the same concern.
- The `new Response(proc.stdout).text()` pattern is a Bun-specific idiom that would need updating in three places if the API changes.

### Recommended Correction

Extract a small `runProcess` utility that encapsulates the spawn → capture → return pattern:

```typescript
// src/process.ts
export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function runProcess(
  command: string[],
  opts?: { cwd?: string; timeout?: number },
): Promise<ProcessResult> {
  const proc = Bun.spawn(command, {
    cwd: opts?.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (opts?.timeout) {
    setTimeout(() => proc.kill(), opts.timeout);
  }

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return { stdout, stderr, exitCode };
}
```

Then each call site becomes a thin wrapper that adds its domain-specific concerns:

- `invokeClaude`: calls `runProcess(["claude", ...args])`, throws on non-zero exit
- `createCommandRunner`: calls `runProcess([command, ...args], { cwd })`, merges output
- `runGate`: calls `runProcess(["sh", "-c", gate.command], { cwd, timeout })`, truncates output

This consolidates the "how to spawn a process in Bun" knowledge into one place while keeping each caller focused on its domain logic. The timeout handling that currently only exists in `gates.ts` would become available to all callers naturally.

### What I Considered and Rejected

I evaluated several other candidates:

- **`IterateOptions` vs `GitHubIterateOptions` overlap** — These share many fields but represent genuinely different command shapes (GitHub mode has `proposals`, local mode doesn't). They're independent decisions that happen to overlap, not knowledge duplication.
- **The `isJson` flag handling across commands** — Each command checks `parsed.flags.json === true` and branches. But each command has different JSON output shapes, so this is appropriately independent.
- **`loadConfig` field-by-field merging** — Could use a generic deep merge, but the current explicit approach is more readable and type-safe for 8 fields.
- **Type assertions** (`as HoneMode`, `as GateDefinition[]`) — These exist at boundary points (JSON parsing, config loading) where runtime validation would be ideal but the risk is low. Not the most violated principle.

The subprocess duplication is the clearest case where three locations must change together for the same reason, making it the most substantive opportunity for improvement.