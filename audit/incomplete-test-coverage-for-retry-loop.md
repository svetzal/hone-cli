Now I have a thorough understanding of the entire codebase. Let me deliver the assessment.

---

## Assessment: hone-cli against TypeScript Craftsperson Principles

### Principle Evaluation Summary

| Principle | Status | Notes |
|-----------|--------|-------|
| **All tests pass** | ✅ Good | 13 tests, 0 failures |
| **Reveals intent** | ✅ Good | Clear naming, well-structured modules |
| **No knowledge duplication** | ✅ Good | Minimal duplication |
| **Minimal entities** | ✅ Good | No premature abstractions |
| **Functional Core, Imperative Shell** | ✅ Good | Pure `iterate()` takes injected `ClaudeInvoker`, side effects at edges |
| **Tests Are the Executable Spec** | ⚠️ Moderate | Gaps in coverage (see below) |
| **Compose Over Inherit** | ✅ Good | No class hierarchies, composition throughout |
| **Type System Leverage** | ⚠️ Minor | A few `unknown`/unvalidated spots, but overall reasonable |
| **Small, Safe Increments** | ✅ Good | Each module is small and focused |

---

### Most Violated Principle: *Tests Are the Executable Spec*

This is the principle where the project has the most significant gap between where it is and where it should be. Here's the detailed breakdown:

#### What's Good

The project already demonstrates strong testing instincts:
- `ClaudeInvoker` type enables dependency injection — `iterate()` never touches the real `claude` CLI in tests
- Tests use temp directories and clean up after themselves
- The iterate test verifies the full workflow end-to-end with a mock
- Gate detection is well-covered across all four project types plus overrides

#### What's Missing

**1. No tests for the retry/verification inner loop (the project's most critical behavior)**

The entire value proposition of hone is: *"The agent never self-certifies — the tool independently verifies every gate."* Yet the retry loop in `iterate.ts` (lines 130-170) is completely untested. The only iterate test uses `skipGates: true`, which bypasses the entire inner loop. There are no tests verifying:
- That gates are actually run after execution
- That a failed required gate triggers a retry
- That the retry prompt includes the correct failure context
- That `maxRetries` is respected
- That optional gate failures don't trigger retries
- That `requiredPassed` (not `allPassed`) controls the loop

This is the most important behavior in the system, and it has zero test coverage.

**2. No tests for `runGate` or `runAllGates` actual execution**

`gates.test.ts` only tests `detectGates` (static gate configuration). The actual gate *execution* functions (`runGate`, `runAllGates`) are never tested. These functions handle subprocess spawning, timeout logic, output capture, and truncation — all critical behaviors with subtle edge cases.

**3. No tests for command handlers**

None of the five command handlers (`commands/*.ts`) have any tests. While they're thin wrappers, they contain validation logic (e.g., `iterateCommand` validates agent existence, parses flag overrides, mutates config), error handling, and `process.exit()` calls that could silently break.

**4. `sanitizeName` and `buildRetryPrompt` are untested as units**

These are pure functions with clear contracts — ideal test candidates. `sanitizeName` has one indirect test via the "falls back to timestamp" test, but its happy path parsing behavior (extracting the first kebab-case match from potentially messy LLM output) deserves explicit coverage.

**5. No tests for `audit.ts`**

`listIterations` has non-trivial file grouping logic (stripping `-plan`, `-actions`, `-retry-N-actions` suffixes, grouping by base name, sorting by date). This is pure logic operating on file system state — easily testable with temp directories.

**6. No tests for `config.ts` merge behavior**

`loadConfig` merges user config with defaults using spread + nullish coalescing. The test only covers `getDefaultConfig()`. There's no test verifying that partial user configs correctly merge (e.g., overriding just `models.assess` while preserving other defaults).

---

### How to Correct It

**Priority 1 — Test the retry loop (the core value proposition):**

Create tests for `iterate()` with `skipGates: false` that use a mock `ClaudeInvoker` AND a mock for `runAllGates`. The iterate function currently imports `runAllGates` directly from `./gates.ts`, which makes it hard to mock. The correction would be to either:
- **(a)** Inject a gate runner the same way `ClaudeInvoker` is injected (add a `gateRunner` parameter to `iterate()` or `IterateOptions`), or
- **(b)** Extract the retry loop into a pure function that takes the gate results as input, making it independently testable

Option (a) is more consistent with the existing pattern. Then write tests for:
- Gates pass on first attempt → no retries, success
- Required gate fails, retry succeeds → 1 retry, success
- Required gate fails, max retries exhausted → failure
- Optional gate fails → no retry triggered, still success
- Retry prompt contains original plan and failure output

**Priority 2 — Test `runGate` / `runAllGates` with real subprocesses:**

Use simple commands like `echo "ok"` (passes) and `exit 1` (fails) in temp directories. Verify output capture, exit code handling, and timeout behavior.

**Priority 3 — Test `sanitizeName` and `buildRetryPrompt` directly:**

These are pure functions. Write focused unit tests covering edge cases: messy LLM output with markdown backticks, empty input, very long names, prompts with multiple failed gates.

**Priority 4 — Test `listIterations` file grouping:**

Create temp audit directories with known files, verify grouping and sorting.

The key architectural change is making the gate runner injectable in `iterate()`, mirroring the `ClaudeInvoker` pattern. This follows the project's existing "functional core, imperative shell" design and unlocks comprehensive testing of the most critical path without requiring real subprocesses.