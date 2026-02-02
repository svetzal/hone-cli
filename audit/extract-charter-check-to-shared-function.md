All 236 tests pass. Zero type errors. Now I have a comprehensive view of the codebase. Let me finalize my assessment.

```json
{ "severity": 3, "principle": "No Knowledge Duplication", "category": "architecture" }
```

## Assessment: Charter Check Logic Duplicated Across Both Iteration Paths

### The Violation

The charter checking workflow is implemented twice — once in `iterate.ts` (lines 259-284) and once in `github-iterate.ts` (lines 298-310). Both contain the same sequence of decisions:

1. Check `skipCharter` flag
2. Call `charterChecker(folder, config.minCharterLength)`
3. If it fails, report progress messages with guidance
4. Return/throw to halt the pipeline

These two implementations encode the **same business rule** (charter clarity is a prerequisite for any iteration) but express it differently:

- **Local mode** (`iterate.ts`): Returns an `IterationResult` with `success: false` and `skippedReason`
- **GitHub mode** (`github-iterate.ts`): Throws `new Error("Charter clarity insufficient")`

This divergence means the same policy question — *"What happens when charter clarity is insufficient?"* — has two answers that must be kept in sync manually. If you change the guidance messages, threshold behavior, or the list of checked sources, you need to touch both files. Today it's 25 lines of duplication; tomorrow when you add a third mode or additional pre-checks, it becomes three.

### Why This Matters (Severity: 3)

This is a moderate violation, not critical. The codebase is well-tested and both paths are covered, so the risk of silent divergence is low *today*. But this is the kind of duplication that compounds:

- The `IterateOptions` and `GitHubIterateOptions` interfaces both declare `charterChecker?: CharterCheckerFn` and `skipCharter?: boolean` — the same injectable slots.
- The progress message patterns (`"Checking project charter clarity..."`, `"Charter check passed."`, `"  → ${g}"`) are near-identical between the two files.
- If you add another pre-pipeline validation (e.g., checking for a `.hone-gates.json` before GitHub mode), you'll face the same question: do I copy this into both paths?

The two iteration modes share the same pipeline structure (charter → assess → name → triage → plan → execute → verify), but `github-iterate.ts` composes stages differently — it wraps them in a three-phase process (housekeeping → execute approved → propose). The shared stages (`runAssessStage`, `runNameStage`, `runPlanStage`, `runExecuteWithVerify`) are already extracted into `iterate.ts` and reused from `github-iterate.ts`. The charter check is the one pre-pipeline concern that wasn't extracted alongside them.

### Correction Approach

Extract the charter check into a shared function in `charter.ts` (or a new `pipeline.ts` if you prefer) that encapsulates the full check-and-report cycle. Both `iterate()` and `githubIterate()` would call it, each mapping the result to their own error shape.

A concrete sketch:

```typescript
// In charter.ts or a new shared pipeline module
export async function runCharterCheck(
  folder: string,
  minLength: number,
  checker: CharterCheckerFn,
  onProgress: (stage: string, message: string) => void,
): Promise<CharterCheckResult | null> {
  onProgress("charter", "Checking project charter clarity...");
  const result = await checker(folder, minLength);
  if (!result.passed) {
    onProgress("charter", "Charter clarity insufficient.");
    for (const g of result.guidance) {
      onProgress("charter", `  → ${g}`);
    }
    return result;
  }
  onProgress("charter", "Charter check passed.");
  return null; // null = passed, no issue
}
```

Then in each caller:

```typescript
// iterate.ts
if (!skipCharter) {
  const failure = await runCharterCheck(folder, config.minCharterLength, charterChecker, onProgress);
  if (failure) {
    return { ...emptyResult, success: false, charterCheck: failure, skippedReason: "Charter clarity insufficient" };
  }
}

// github-iterate.ts
if (!skipCharter) {
  const failure = await runCharterCheck(folder, config.minCharterLength, charterChecker, onProgress);
  if (failure) {
    throw new Error("Charter clarity insufficient");
  }
}
```

This collapses the duplicated check-and-report logic into a single source of truth while letting each mode decide how to surface the failure. The decision about *what constitutes a charter failure* lives in one place; the decision about *what to do about it* stays mode-specific.

### Other Observations (Not Rising to Most-Violated)

- **Config loading has no runtime validation**: `loadConfig` spreads `userConfig` fields without checking types. A config file with `"maxRetries": "banana"` would silently produce `NaN`. This is a lesser issue — the tool is CLI-only and users are unlikely to write malformed JSON — but it's worth noting.
  
- **`json-extraction.ts` has no tests**: The only untested source file with implementation logic. It's 29 lines and used by two critical paths (assessment parsing and triage). Low risk, but a gap.

- **Three `IterationResult` construction sites** in `iterate.ts` (lines 269, 315, 354) repeat the full 11-field shape with slight variations. This is borderline — the fields differ per exit point and extracting a factory could reduce clarity. I'd leave this as-is; TypeScript's type system already catches missing fields.

Overall the codebase is **well-crafted** — zero `any` types, strict mode, excellent test coverage (236 tests, 1.5:1 test-to-code ratio), clean dependency injection, and small focused functions. The charter check duplication is the most actionable improvement available.