## Plan: Extract Shared Subprocess Execution Utility

### Context

Three files (`src/claude.ts`, `src/github.ts`, `src/gates.ts`) independently implement the same subprocess spawning and output capture pattern. This is knowledge duplication — they represent the same decision about how this tool runs external processes. If Bun's subprocess API changes, or if we need to add streaming, size limits, or encoding handling, all three must change for the same reason.

### Step-by-step Plan

#### Step 1: Create `src/process.ts` with `runProcess` utility

Create a new file `src/process.ts` that exports:

- A `ProcessResult` interface with `stdout: string`, `stderr: string`, `exitCode: number`
- A `runProcess` function that:
  - Accepts `command: string[]` and optional `opts: { cwd?: string; timeout?: number }`
  - Uses `Bun.spawn()` with stdout/stderr piped
  - Handles optional timeout via `setTimeout` + `proc.kill()` (porting the existing logic from `gates.ts`)
  - Captures stdout and stderr via `new Response(proc.stdout).text()` / `new Response(proc.stderr).text()`
  - Awaits `proc.exited` for the exit code
  - Returns `{ stdout, stderr, exitCode }`

This consolidates the "how to spawn and capture a process in Bun" knowledge into one place.

#### Step 2: Create `src/process.test.ts` with tests for `runProcess`

Write tests that verify:

- Successful command execution captures stdout, stderr, and exit code 0
- Failed command execution captures the non-zero exit code
- Timeout kills the process (use a `sleep` command with a short timeout)
- The `cwd` option is respected (run a command in a temp directory)

Use real subprocesses (`echo`, `sh -c`, `sleep`) rather than mocking Bun internals — these are integration-style tests for a thin wrapper.

#### Step 3: Refactor `src/claude.ts` to use `runProcess`

In `invokeClaude()`:

- Import `runProcess` from `./process.ts`
- Replace the inline `Bun.spawn` / `new Response` / `proc.exited` block with a call to `runProcess(["claude", ...args])`
- Keep the existing domain logic: throw on non-zero exit code with the stderr message, return stdout on success
- The function signature and behavior remain identical to callers

#### Step 4: Refactor `src/github.ts` to use `runProcess`

In `createCommandRunner()`:

- Import `runProcess` from `./process.ts`
- Replace the inline subprocess block with a call to `runProcess([command, ...args], { cwd: opts?.cwd })`
- Keep the existing domain logic: merge stdout + stderr into a single output string, return `{ output, exitCode }`
- The `CommandRunner` type and `createCommandRunner` signature remain unchanged

#### Step 5: Refactor `src/gates.ts` to use `runProcess`

In `runGate()`:

- Import `runProcess` from `./process.ts`
- Replace the inline subprocess block (including the `setTimeout` / `proc.kill` timeout handling) with a call to `runProcess(["sh", "-c", gate.command], { cwd: projectDir, timeout: gateTimeout })`
- Keep the existing domain logic: output truncation (last 200 lines), `GateResult` construction with passed/output fields
- The `runGate` function signature and `GateResult` type remain unchanged

#### Step 6: Run all quality gates

- Run `bun test` — all existing tests must pass (the refactor should be invisible to callers)
- Run `bunx tsc --noEmit` — zero type errors
- Run `bun build src/cli.ts --compile --outfile=build/hone` — binary compiles successfully

### What does NOT change

- No public API changes — all function signatures, types, and behaviors remain identical
- No test changes needed for existing tests (they mock at the right boundaries already)
- No changes to `types.ts`, `cli.ts`, `iterate.ts`, `audit.ts`, `config.ts`, `agents.ts`, or any command files
- The `ProcessRunner` type in `types.ts` and its injection pattern stay as-is — `runProcess` is a lower-level utility that the injectable `ProcessRunner` implementations can use internally

### Risk assessment

Low risk. Each refactoring step is mechanical: extract the identical pattern, call the shared utility, keep domain logic in place. Existing tests verify the domain behavior of each caller, so they'll catch any regression.