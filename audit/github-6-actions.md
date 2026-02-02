Perfect! All quality gates pass. Let me create a summary of what was done:

## Summary

I successfully eliminated the subprocess execution knowledge duplication by extracting a shared `runProcess` utility. Here's what was accomplished:

### Changes Made

**1. Created `src/process.ts`** - A new utility module containing:
- `ProcessResult` interface (stdout, stderr, exitCode)
- `RunProcessOptions` interface (cwd, timeout)
- `runProcess()` function that consolidates the Bun subprocess spawning pattern with timeout handling

**2. Created `src/process.test.ts`** - Comprehensive tests covering:
- Successful command execution
- Non-zero exit codes
- Stderr capture
- Timeout kills processes correctly
- `cwd` option works
- Both stdout and stderr captured

**3. Refactored `src/claude.ts`** - `invokeClaude()` now uses `runProcess()`:
- Removed inline `Bun.spawn` / `new Response` pattern
- Kept domain logic (throw on non-zero exit with stderr message)
- Function signature unchanged

**4. Refactored `src/github.ts`** - `createCommandRunner()` now uses `runProcess()`:
- Removed inline subprocess block
- Kept domain logic (merge stdout + stderr)
- `CommandRunner` type unchanged

**5. Refactored `src/gates.ts`** - `runGate()` now uses `runProcess()`:
- Removed inline subprocess block and timeout handling
- Kept domain logic (output truncation to last 200 lines)
- `runGate` signature unchanged

### Key Implementation Detail

The critical fix was properly clearing the timeout after process completion. The original `gates.ts` had `clearTimeout(timeoutId)` which we preserved in the shared utility to prevent dangling timeouts from killing processes that have already completed.

### Quality Gates Status

✅ All tests pass (236 tests)
✅ TypeScript type checking clean (0 errors)
✅ Binary compiles successfully
✅ Binary runs correctly (`./build/hone --version`)

### Impact

- **DRY principle satisfied** - The "how to spawn a process in Bun" knowledge now lives in exactly one place
- **Consistency improved** - All three locations now benefit from the timeout handling that previously only existed in `gates.ts`
- **Maintainability enhanced** - Future Bun API changes or subprocess handling improvements require only one update
- **Zero behavioral changes** - All existing functionality preserved; tests verify this

The refactoring is complete and all quality gates pass.