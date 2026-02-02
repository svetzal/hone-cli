Excellent! All quality gates pass. Now let me create a summary of what was accomplished:

## Summary

I've successfully eliminated knowledge duplication in the test mock infrastructure by consolidating the repeated prompt-extraction and dispatch logic into shared test helpers. Here's what was done:

### Changes Made

**1. Created `src/test-helpers.ts`**
   - Added `extractPrompt()` — single source of truth for extracting the prompt from Claude CLI args
   - Added `createIterateMock()` — factory for iterate workflow mocks with stage-based dispatch
   - Added `createDeriveMock()` — factory for derive workflow mocks with call-type dispatch
   - Each factory accepts an `onCall` callback for test assertions on invocation args

**2. Created `src/test-helpers.test.ts`**
   - Comprehensive tests for all three helper functions
   - Covers all dispatch paths and edge cases
   - 11 tests, all passing

**3. Refactored `src/iterate.test.ts`**
   - Replaced 7 duplicated inline mock implementations with calls to `createIterateMock()`
   - Updated retry prompt extraction to use `extractPrompt()` helper
   - Removed `ClaudeInvoker` type import (no longer needed)
   - All 16 tests still pass, behavior unchanged

**4. Refactored `src/derive.test.ts`**
   - Replaced 2 duplicated inline mock implementations with calls to `createDeriveMock()`
   - Updated prompt capture logic to use `extractPrompt()` helper
   - Removed `ClaudeInvoker` type import
   - All 11 tests still pass, behavior unchanged

### Impact

**Before:** 9 separate implementations of prompt-extraction and dispatch logic across test files. If a prompt prefix changed (e.g., `"Assess the project"` → `"Evaluate the project"`), you'd need to update 7+ locations.

**After:** 
- Prompt extraction logic lives in **1 place** (`extractPrompt()`)
- Iterate stage dispatch lives in **1 place** (`createIterateMock()`)
- Derive stage dispatch lives in **1 place** (`createDeriveMock()`)
- Prompt wording changes require updating exactly **1 function**

### Quality Gates ✅

- ✅ **All tests pass** — 143 tests (11 new, 132 existing), zero failures
- ✅ **Type check clean** — `bunx tsc --noEmit` with zero errors
- ✅ **Security scan clean** — `osv-scanner .` found no vulnerabilities
- ✅ **Build successful** — Binary compiles and runs (`./build/hone --version`)
- ✅ **No behavior changes** — All test assertions remain identical

This refactoring eliminates the most significant violation of the **No Knowledge Duplication** principle in the codebase, making the test infrastructure more maintainable and reducing the risk of inconsistent mocks diverging over time.