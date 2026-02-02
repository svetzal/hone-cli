Now I have a thorough understanding of the codebase. Let me create a detailed, actionable plan.

---

## Step-by-Step Plan: Improving Test Coverage for hone-cli

### Step 1: Make the Gate Runner Injectable in `iterate()`

**File:** `src/iterate.ts`

**What to do:**

1. Define a new type alias `GateRunner` in `src/types.ts`:
   ```typescript
   export type GateRunner = (projectDir: string, timeout: number) => Promise<GatesRunResult>;
   ```

2. Add an optional `gateRunner` parameter to the `iterate()` function signature. Currently the function signature is:
   ```typescript
   export async function iterate(
     agent: string,
     folder: string,
     config: HoneConfig,
     claude: ClaudeInvoker,
     options: { skipGates?: boolean; onProgress?: (stage: string, message: string) => void } = {},
   ): Promise<IterationResult>
   ```
   
   Add `gateRunner` to the options object:
   ```typescript
   export async function iterate(
     agent: string,
     folder: string,
     config: HoneConfig,
     claude: ClaudeInvoker,
     options: {
       skipGates?: boolean;
       gateRunner?: GateRunner;
       onProgress?: (stage: string, message: string) => void;
     } = {},
   ): Promise<IterationResult>
   ```

3. Inside `iterate()`, destructure the new option with a default that falls back to the real `runAllGates`:
   ```typescript
   const { skipGates = false, gateRunner = runAllGates, onProgress = () => {} } = options;
   ```

4. Replace the direct call to `runAllGates(folder, config.gateTimeout)` in the retry loop (around line 140) with `gateRunner(folder, config.gateTimeout)`.

5. Update `src/commands/iterate.ts` — since the production call site does not pass `gateRunner`, it will automatically use the default `runAllGates`. No changes needed there. Verify this by reading the file and confirming the call to `iterate()` does not need updating.

**Why:** This mirrors the existing `ClaudeInvoker` injection pattern. Tests can now inject a mock gate runner without touching the real subprocess logic.

---

### Step 2: Export `sanitizeName` and `buildRetryPrompt` for Direct Testing

**File:** `src/iterate.ts`

**What to do:**

1. Change `function sanitizeName(...)` to `export function sanitizeName(...)` (line 14).
2. Change `function buildRetryPrompt(...)` to `export function buildRetryPrompt(...)` (line 20).

**Why:** These are pure functions with clear contracts. Exporting them enables focused unit tests without needing to go through the full `iterate()` flow.

---

### Step 3: Write Tests for the Retry/Verification Inner Loop

**File:** `src/iterate.test.ts`

**What to do:** Add the following test cases, all using a mock `ClaudeInvoker` and a mock `GateRunner`:

1. **"gates pass on first attempt — no retries, success"**
   - Mock `gateRunner` returns `{ allPassed: true, requiredPassed: true, results: [] }`.
   - Call `iterate()` with `skipGates: false` and the mock `gateRunner`.
   - Assert: `result.success` is `true`, `result.retries` is `0`, `result.gatesResult.requiredPassed` is `true`.
   - Assert: The mock `ClaudeInvoker` was called exactly 4 times (assess, name, plan, execute — no retry calls).
   - Assert: The mock `gateRunner` was called exactly once.

2. **"required gate fails, retry succeeds — 1 retry, success"**
   - Mock `gateRunner`:
     - First call returns `{ requiredPassed: false, allPassed: false, results: [{ name: "test", command: "npm test", passed: false, required: true, output: "FAIL: 1 test failed", exitCode: 1 }] }`.
     - Second call returns `{ requiredPassed: true, allPassed: true, results: [{ name: "test", command: "npm test", passed: true, required: true, output: "All tests passed", exitCode: 0 }] }`.
   - Assert: `result.success` is `true`, `result.retries` is `1`.
   - Assert: The mock `ClaudeInvoker` was called 5 times (4 stages + 1 retry execution).
   - Assert: The mock `gateRunner` was called 2 times.
   - Assert: A retry actions file was saved (check for file `*-retry-1-actions.md` in the audit dir).

3. **"required gate fails, max retries exhausted — failure"**
   - Set `config.maxRetries` to `2`.
   - Mock `gateRunner` always returns `{ requiredPassed: false, ... }`.
   - Assert: `result.success` is `false`, `result.retries` is `2`.
   - Assert: The mock `ClaudeInvoker` was called 6 times (4 stages + 2 retries).
   - Assert: The mock `gateRunner` was called 3 times (initial + 2 retries).

4. **"optional gate fails — no retry triggered, still success"**
   - Mock `gateRunner` returns `{ allPassed: false, requiredPassed: true, results: [{ name: "security", command: "npm audit", passed: false, required: false, output: "2 moderate vulnerabilities", exitCode: 1 }] }`.
   - Assert: `result.success` is `true`, `result.retries` is `0`.
   - Assert: The mock `ClaudeInvoker` was called exactly 4 times (no retry).
   - Assert: `result.gatesResult.allPassed` is `false` but `result.gatesResult.requiredPassed` is `true`.

5. **"retry prompt contains original plan and failure output"**
   - Mock `gateRunner` first call fails, second call passes.
   - Capture the arguments passed to the mock `ClaudeInvoker` on the 5th call (retry execution).
   - Parse the prompt from the captured args (it's the argument after `-p`).
   - Assert: The prompt contains "Original Plan" and the plan content from the mock.
   - Assert: The prompt contains "Failed Gates" and the gate failure output.

**Test setup pattern for all retry tests:**

```typescript
// Each test should:
// 1. Create a temp directory with a package.json (so detectGates works if needed)
// 2. Create a mock ClaudeInvoker that returns staged responses:
//    - Call 1 (assess): "Assessment content"
//    - Call 2 (name): "test-issue-name"
//    - Call 3 (plan): "Plan content"
//    - Call 4+ (execute/retry): "Execution content"
// 3. Create a mock GateRunner as described per test case
// 4. Call iterate() with skipGates: false and gateRunner: mockGateRunner
// 5. Clean up temp directory
```

---

### Step 4: Write Unit Tests for `sanitizeName`

**File:** `src/iterate.test.ts`

**What to do:** Add a `describe("sanitizeName", ...)` block with these tests:

1. **"extracts first kebab-case segment from clean LLM output"**
   - Input: `"fix-broken-auth-handler"` → Output: `"fix-broken-auth-handler"`

2. **"extracts from output with surrounding markdown/whitespace"**
   - Input: `` "`improve-error-handling`" `` → Output: `"improve-error-handling"`
   - (The backticks are not in the `[a-z0-9-]` character class, so the regex skips them)

3. **"caps at 50 characters"**
   - Input: `"a"` repeated 60 times → Output: `"a"` repeated 50 times

4. **"returns empty string for non-matching input"**
   - Input: `"!!!INVALID!!!"` → Output: `""`
   - Input: `"ALLCAPS"` → Output: `""` (uppercase doesn't match `[a-z0-9-]`)

5. **"extracts only first match when multiple segments exist"**
   - Input: `"Here is the name: fix-auth-bug and more stuff"` → Output: `"fix-auth-bug"` 
   - Wait — actually the regex `[a-z0-9-]+` without `g` flag will match the first run of lowercase+digits+hyphens. In `"Here is the name: fix-auth-bug and more stuff"`, the first match would actually be `"ere"` from "Here". Let me reconsider.
   - Actually, `"H"` is uppercase so the regex starts scanning, then `"e"` matches `[a-z]`, so the first match is `"ere"`. This means the regex doesn't actually work as intended for extracting kebab-case names from sentences — it grabs any first lowercase run.
   - Write a test that documents this actual behavior: Input `"The name is fix-auth"` → Output is `"he"` (first lowercase run from "The").
   - This is important to document — it means the naming stage LLM output must be a bare kebab-case name, not a sentence.

6. **"handles output with leading lowercase letters correctly"**
   - Input: `"fix-auth-bug\n"` → Output: `"fix-auth-bug"`

---

### Step 5: Write Unit Tests for `buildRetryPrompt`

**File:** `src/iterate.test.ts`

**What to do:** Add a `describe("buildRetryPrompt", ...)` block with these tests:

1. **"includes original plan and failed gate output"**
   - Call with plan `"Step 1: Fix the thing"` and one failed gate `{ name: "test", output: "FAIL: expected 1 got 2" }`.
   - Assert output contains `"## Original Plan"` and `"Step 1: Fix the thing"`.
   - Assert output contains `"## Failed Gates"`, `"### Gate: test"`, and `"FAIL: expected 1 got 2"`.

2. **"formats multiple failed gates"**
   - Call with two failed gates.
   - Assert both gates appear in the output with proper headings.

3. **"includes instruction to not regress"**
   - Assert the output contains `"Fix the failures below WITHOUT regressing"`.

---

### Step 6: Write Tests for `runGate` with Real Subprocesses

**File:** `src/gates.test.ts`

**What to do:** Add a `describe("runGate", ...)` block:

1. **"returns passed result for successful command"**
   - Call `runGate({ name: "test", command: "echo 'hello'", required: true }, tmpDir, 10000)`.
   - Assert: `result.passed` is `true`, `result.exitCode` is `0`, `result.output` contains `"hello"`.

2. **"returns failed result for failing command"**
   - Call `runGate({ name: "test", command: "exit 1", required: true }, tmpDir, 10000)`.
   - Assert: `result.passed` is `false`, `result.exitCode` is `1`.

3. **"captures stderr in output"**
   - Call `runGate({ name: "lint", command: "echo 'error' >&2", required: true }, tmpDir, 10000)`.
   - Assert: `result.output` contains `"error"`.

4. **"preserves gate metadata in result"**
   - Call with `required: false`.
   - Assert: `result.required` is `false`, `result.name` and `result.command` match input.

5. **"handles command timeout"** (use a shorter timeout)
   - Call `runGate({ name: "slow", command: "sleep 30", required: true }, tmpDir, 500)`.
   - Assert: `result.passed` is `false`.

---

### Step 7: Write Tests for `runAllGates`

**File:** `src/gates.test.ts`

**What to do:** Add a `describe("runAllGates", ...)` block:

1. **"returns all-passed when all gates succeed"**
   - Create a temp dir with `.hone-gates.json` containing two gates that both succeed (e.g., `echo ok`).
   - Assert: `result.allPassed` is `true`, `result.requiredPassed` is `true`, `result.results.length` is `2`.

2. **"returns requiredPassed true when only optional gates fail"**
   - Create `.hone-gates.json` with one required gate that passes and one optional gate that fails.
   - Assert: `result.allPassed` is `false`, `result.requiredPassed` is `true`.

3. **"returns requiredPassed false when a required gate fails"**
   - Create `.hone-gates.json` with one required gate that fails.
   - Assert: `result.requiredPassed` is `false`.

4. **"returns all-passed with empty results when no gates detected"**
   - Use an empty temp directory.
   - Assert: `result.allPassed` is `true`, `result.requiredPassed` is `true`, `result.results` is `[]`.

---

### Step 8: Write Tests for `truncateOutput`

**File:** `src/gates.test.ts`

**What to do:** Export `truncateOutput` from `gates.ts` (change `function truncateOutput` to `export function truncateOutput`), then add tests:

1. **"returns full output when under max lines"**
   - Input: 10 lines → Output: same 10 lines unchanged.

2. **"truncates to last N lines with notice"**
   - Input: 250 lines, maxLines: 200 → Output starts with `"... (50 lines truncated)"` followed by the last 200 lines.

3. **"uses default of 200 lines"**
   - Input: 300 lines → Output contains `"... (100 lines truncated)"`.

---

### Step 9: Write Tests for `listIterations` File Grouping

**File:** `src/audit.test.ts` (new file)

**What to do:** Create the file with these tests:

1. **"groups related audit files by base name"**
   - Create temp dir with files:
     - `fix-auth-bug.md`
     - `fix-auth-bug-plan.md`
     - `fix-auth-bug-actions.md`
     - `improve-logging.md`
     - `improve-logging-plan.md`
   - Call `listIterations(tmpDir)`.
   - Assert: 2 entries returned.
   - Assert: Entry with name `"fix-auth-bug"` has 3 files.
   - Assert: Entry with name `"improve-logging"` has 2 files.

2. **"groups retry action files correctly"**
   - Create temp dir with files:
     - `fix-auth-bug.md`
     - `fix-auth-bug-plan.md`
     - `fix-auth-bug-actions.md`
     - `fix-auth-bug-retry-1-actions.md`
     - `fix-auth-bug-retry-2-actions.md`
   - Assert: 1 entry returned with name `"fix-auth-bug"` and 5 files.

3. **"sorts entries newest-first by file modification time"**
   - Create two groups of files with different mtimes (write one group, wait briefly, write another).
   - Assert: The newer group appears first in the returned array.

4. **"returns empty array for non-existent directory"**
   - Call `listIterations("/tmp/nonexistent-dir-" + Date.now())`.
   - Assert: Returns `[]`.

5. **"returns empty array for directory with no .md files"**
   - Create temp dir with a `.txt` file only.
   - Assert: Returns `[]`.

---

### Step 10: Write Tests for `loadConfig` Merge Behavior

**File:** `src/config.test.ts`

**What to do:** Add tests for `loadConfig`. Since `loadConfig` reads from `~/.config/hone/config.json`, the tests need to either:
- **(Preferred)** Refactor `loadConfig` to accept an optional config file path parameter with a default of `~/.config/hone/config.json`, then tests can pass a temp file path.
- OR use environment variable manipulation (less clean).

Refactoring approach — change the `loadConfig` signature:

```typescript
export async function loadConfig(configPath?: string): Promise<HoneConfig> {
  const defaults = getDefaultConfig();
  const resolvedPath = configPath ?? join(homedir(), ".config", "hone", "config.json");
  // ... rest unchanged, using resolvedPath
}
```

Update `src/commands/iterate.ts` and any other callers that invoke `loadConfig()` without arguments — they continue to work unchanged since the parameter is optional.

Then write these tests:

1. **"returns defaults when config file does not exist"**
   - Call `loadConfig("/tmp/nonexistent-config-" + Date.now() + ".json")`.
   - Assert: Returns same values as `getDefaultConfig()`.

2. **"merges partial model overrides with defaults"**
   - Write a temp JSON file with `{ "models": { "assess": "sonnet" } }`.
   - Call `loadConfig(tempPath)`.
   - Assert: `config.models.assess` is `"sonnet"`.
   - Assert: `config.models.plan` is `"opus"` (default preserved).
   - Assert: `config.models.execute` is `"sonnet"` (default preserved).

3. **"overrides non-model fields"**
   - Write a temp JSON file with `{ "maxRetries": 5, "gateTimeout": 60000 }`.
   - Call `loadConfig(tempPath)`.
   - Assert: `config.maxRetries` is `5`, `config.gateTimeout` is `60000`.
   - Assert: `config.models` equals defaults (untouched).

4. **"respects falsy values like maxRetries: 0"**
   - Write a temp JSON file with `{ "maxRetries": 0 }`.
   - Call `loadConfig(tempPath)`.
   - Assert: `config.maxRetries` is `0` (not the default `3`).

5. **"returns defaults for invalid JSON"**
   - Write a temp file with `"not valid json {{{"`.
   - Call `loadConfig(tempPath)`.
   - Assert: Returns same values as `getDefaultConfig()`.

---

### Step 11: Run All Tests and Verify Coverage

**What to do:**

1. Run `bun test` to verify all tests pass.
2. Verify no existing tests were broken by the refactoring (especially the existing iterate tests that use `skipGates: true` — they should continue to work since `gateRunner` defaults to `runAllGates` and is never invoked when `skipGates` is `true`).
3. Review the output for any test failures and fix them.

---

### Step 12: Clean Up and Final Verification

**What to do:**

1. Run `bunx tsc --noEmit` to verify no type errors were introduced.
2. Review all new test files for clarity and intent-revealing test names.
3. Ensure all temp directories are cleaned up in `afterEach`/`finally` blocks.
4. Verify the `StageOutput` type in `types.ts` — it's defined but never used. Leave it for now (it may be intended for future use) but note it for awareness.

---

### Summary of Changes

| File | Change Type | Description |
|------|-------------|-------------|
| `src/types.ts` | Add type | Add `GateRunner` type alias |
| `src/iterate.ts` | Refactor | Add `gateRunner` option with default, export `sanitizeName` and `buildRetryPrompt` |
| `src/gates.ts` | Refactor | Export `truncateOutput` |
| `src/config.ts` | Refactor | Add optional `configPath` parameter to `loadConfig` |
| `src/iterate.test.ts` | Add tests | 5 retry loop tests, 6 `sanitizeName` tests, 3 `buildRetryPrompt` tests |
| `src/gates.test.ts` | Add tests | 5 `runGate` tests, 4 `runAllGates` tests, 3 `truncateOutput` tests |
| `src/audit.test.ts` | New file | 5 `listIterations` tests |
| `src/config.test.ts` | Add tests | 5 `loadConfig` merge tests |

**Total new tests: ~36** (from current 13, roughly tripling coverage)

**Production code changes are minimal:** Adding one type, making three functions exported, adding one optional parameter with a default value. No behavioral changes to existing functionality.