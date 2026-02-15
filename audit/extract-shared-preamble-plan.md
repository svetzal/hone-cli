## Plan: Extract Shared Pipeline Preamble to Eliminate Knowledge Duplication

### Context

The charter check and preflight gate validation sequences are duplicated between `iterate.ts` (local mode) and `github-iterate.ts` (GitHub mode). Both encode the same business decision — "verify project readiness before doing LLM work" — but differ only in how they signal failure (return vs throw). This plan extracts a shared `runPreamble()` function.

### Step 1: Create `src/preamble.ts` with the shared preamble function

Create a new file `src/preamble.ts` that exports:

1. A `PreambleOptions` interface containing the shared dependency fields needed by both modes:
   - `folder: string`
   - `agent: string`
   - `config: HoneConfig`
   - `skipCharter: boolean`
   - `skipGates: boolean`
   - `gateResolver: GateResolverFn` (use the same type signature as in `iterate.ts`)
   - `gateRunner: GateRunner` (use the same type signature as in `iterate.ts`)
   - `charterChecker: CharterCheckerFn` (use the same type signature as in `iterate.ts`)
   - `claude: ClaudeInvoker`
   - `onProgress: (stage: string, message: string) => void`

2. A `PreambleResult` discriminated union type:
   ```typescript
   type PreambleResult =
     | { passed: true; charterCheck: CharterCheckResult | null; gates: GateDefinition[] }
     | { passed: false; charterCheck: CharterCheckResult | null; gates: GateDefinition[]; failureStage: "charter" | "preflight"; failureReason: string; gatesResult?: GatesRunResult }
   ```

3. An `async function runPreamble(opts: PreambleOptions): Promise<PreambleResult>` that:
   - Runs the charter check if `!skipCharter`, reporting progress via `onProgress("charter", ...)`. If the charter check fails, returns a failure result with `failureStage: "charter"` and the guidance joined into the `failureReason`.
   - Resolves and runs preflight gates if `!skipGates`, reporting progress via `onProgress("preflight", ...)`. If required gates fail, returns a failure result with `failureStage: "preflight"`, the failure messages, and the `gatesResult`.
   - If everything passes (or checks are skipped), returns a success result with the resolved `charterCheck` and `gates`.

Import the necessary types from `types.ts` (e.g., `HoneConfig`, `GateDefinition`, `CharterCheckResult`, `GatesRunResult`). Use the existing function type signatures from `iterate.ts` for the injectable dependencies (`GateResolverFn`, `GateRunner`, `CharterCheckerFn`, `ClaudeInvoker`).

The progress messages should match the existing ones exactly:
- `"Checking project charter clarity..."`
- `"Charter check passed."`
- `"Charter clarity insufficient."`
- `"  → ${g}"` for each guidance item
- `"Resolving quality gates..."`
- `"Running preflight gate check..."`
- `"Preflight passed."`
- `"Preflight failed — required gates did not pass on unmodified codebase."`

### Step 2: Update `src/iterate.ts` to use `runPreamble()`

In `iterate.ts`:

1. Import `runPreamble` and `PreambleOptions` from `./preamble`.

2. Replace the charter check block (approximately lines 257-280) and the preflight gate validation block (approximately lines 282-311) with a single call to `runPreamble()`.

3. After calling `runPreamble()`, check the result:
   - If `!result.passed`, return the appropriate `IterationResult` with `success: false`. Map the failure:
     - For charter failures: set `skippedReason` to `"charter"`, include `charterCheck` from the result
     - For preflight failures: set `skippedReason` to `"preflight"`, include `gates` results
   - If `result.passed`, extract `charterCheckResult` and `preflightGates` from the result and continue with the existing flow.

4. The existing `IterateOptions` interface should keep its fields but can now reference `PreambleOptions` for the shared subset. However, since `IterateOptions` has additional fields beyond the preamble (like `triageRunner`, `skipTriage`, `severityThreshold`, `assessModel`, `planModel`, `executeModel`), keep the interface as-is but note that the preamble fields align. Don't over-abstract here — the goal is extracting the duplicated logic, not creating a type hierarchy.

5. Keep the exported type aliases (`GateResolverFn`, `GateRunner`, `CharterCheckerFn`, `ClaudeInvoker`) in `iterate.ts` since they're part of its public API, but also re-export or reference them from `preamble.ts`. Alternatively, if these types are only defined in `iterate.ts`, consider moving them to `types.ts` so both `iterate.ts` and `preamble.ts` can import them without circular dependencies. Check the current state of `types.ts` to decide.

### Step 3: Update `src/github-iterate.ts` to use `runPreamble()`

In `github-iterate.ts`:

1. Import `runPreamble` from `./preamble`.

2. Replace the charter check block (approximately lines 294-306) and the preflight gate validation block (approximately lines 308-324) with a single call to `runPreamble()`.

3. After calling `runPreamble()`, check the result:
   - If `!result.passed`, throw an `Error` with an appropriate message (preserving the existing throw behavior for GitHub mode). Use the `failureReason` from the result.
   - If `result.passed`, extract the `gates` from the result and continue with the existing flow.

4. The `GitHubIterateOptions` interface keeps its existing fields unchanged.

### Step 4: Create `src/preamble.test.ts` with focused tests

Create a test file `src/preamble.test.ts` that tests `runPreamble()` directly:

1. **Charter check skipped** — When `skipCharter: true`, the charter checker is not called, result is `passed: true`.

2. **Charter check passes** — When charter checker returns `{ passed: true, ... }`, result is `passed: true` with the charter check included.

3. **Charter check fails** — When charter checker returns `{ passed: false, guidance: [...] }`, result is `{ passed: false, failureStage: "charter", ... }` and progress messages include guidance items.

4. **Preflight skipped** — When `skipGates: true`, gate resolver is not called, result is `passed: true` with empty gates.

5. **Preflight passes** — When gates resolve and all required gates pass, result is `passed: true` with the gates included.

6. **Preflight fails** — When a required gate fails, result is `{ passed: false, failureStage: "preflight", ... }` with the gate results.

7. **No gates resolved** — When gate resolver returns empty array, preflight is effectively skipped, result is `passed: true`.

8. **Charter fails before preflight runs** — When charter check fails, gate resolver should NOT be called (early exit).

9. **Progress messages** — Verify that `onProgress` is called with the expected stage names and messages in the right order.

Use mock functions for all dependencies (matching the patterns in the existing test files).

### Step 5: Simplify existing tests in `iterate.test.ts` and `github-iterate.test.ts`

Now that preamble logic is tested in `preamble.test.ts`, the preamble-related tests in the existing files can be simplified:

1. In `iterate.test.ts`:
   - Keep the charter failure and preflight failure tests, but simplify them to verify that `iterate()` correctly maps a preamble failure to the right `IterationResult` shape (i.e., test the integration, not the preamble logic itself).
   - Remove any redundant detailed testing of progress messages during preamble that is now covered by `preamble.test.ts`.

2. In `github-iterate.test.ts`:
   - Similarly, keep the charter and preflight failure tests but simplify them to verify the throw behavior.
   - The detailed preamble logic is now tested in `preamble.test.ts`.

The goal is NOT to remove all preamble tests from these files — it's to ensure they test the integration point (how does iterate/githubIterate handle preamble failure?) rather than re-testing the preamble logic itself.

### Step 6: Run quality gates

1. Run `bun test` — all tests must pass.
2. Run `bunx tsc --noEmit` — zero type errors.
3. Run `osv-scanner .` — check for vulnerabilities.
4. Run `bun build src/cli.ts --compile --outfile=build/hone` — verify it compiles.

### What This Plan Does NOT Do

- Does not unify `iterate()` and `githubIterate()` — they have different post-preamble workflows
- Does not create abstract classes or inheritance hierarchies
- Does not move or restructure any code beyond the preamble extraction
- Does not address the minor non-null assertion or mutation observations from the assessment — those are separate concerns
- Does not add new dependencies