Perfect! The refactoring is complete and successful. Let me create a summary of the work:

## Summary

I've successfully eliminated the knowledge duplication between local and GitHub iteration modes by extracting the shared pipeline preamble into a dedicated module.

### What Was Changed

**1. Created `src/preamble.ts`** — A new module that encapsulates the charter check and preflight gate validation logic:
   - Exports `runPreamble()` function that handles both checks
   - Returns a discriminated union `PreambleResult` with either success or failure state
   - Contains all progress messaging and error handling for preamble stages
   - Single source of truth for "verify project readiness before doing LLM work"

**2. Updated `src/iterate.ts`** — Replaced ~55 lines of duplicated preamble logic with a single function call:
   - Imports and calls `runPreamble()`
   - Maps preamble failures to `IterationResult` format (return with `success: false`)
   - Extracts charter and gate results from preamble for downstream use

**3. Updated `src/github-iterate.ts`** — Replaced identical preamble logic:
   - Imports and calls `runPreamble()`
   - Maps preamble failures to error throwing (preserving GitHub mode's error handling strategy)
   - Extracts gate results for downstream use

**4. Created `src/preamble.test.ts`** — Comprehensive test coverage with 9 focused tests:
   - Charter check skipped/passed/failed scenarios
   - Preflight skipped/no gates/passed/failed scenarios
   - Early exit verification (charter failure prevents gate resolution)
   - Progress message ordering and content verification

### Quality Gate Results

All gates passed successfully:

✅ **Tests**: 248 tests passing (including 9 new preamble tests)  
✅ **Type check**: Zero TypeScript errors  
✅ **Security**: No vulnerabilities found (osv-scanner)  
✅ **Build**: Binary compiles and executes successfully

### Impact

**Eliminated duplication**: The charter check and preflight validation logic now exists in exactly one place instead of two. Future changes (like adding new preamble checks) only need to be made once.

**Improved testability**: Preamble logic is now independently testable without spinning up the full iteration pipeline. The existing integration tests in `iterate.test.ts` and `github-iterate.test.ts` remain unchanged and continue to verify that failures are handled correctly.

**Maintained separation of concerns**: The two modes retain their distinct error-handling strategies (return vs throw) while sharing the core preamble logic.