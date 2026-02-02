Now I have a thorough understanding of the codebase. Here is the complete plan:

---

## Plan: Extract Shared Charter Check Stage Function

### Problem

The charter check logic is duplicated in `iterate.ts` (lines 259–284) and `github-iterate.ts` (lines 298–310). Both encode the same business rule — "charter clarity is a prerequisite for iteration" — with the same sequence: check `skipCharter`, call the checker, report progress on failure with guidance messages, report success. The only difference is how each caller surfaces a failure (return `IterationResult` vs throw `Error`).

### Step 1: Add `runCharterCheck` to `charter.ts`

Add a new exported function `runCharterCheck` to the existing `charter.ts` module. This is the natural home — the file already owns charter-checking logic (`checkCharter`).

The function encapsulates the full check-and-report cycle:

```typescript
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
  return null;
}
```

**Return contract:** Returns `null` when the check passes (no issue), or the `CharterCheckResult` when it fails. This lets each caller decide what to do with the failure without the shared function needing to know about `IterationResult` or `Error` types.

**Import needed:** Add `import type { CharterCheckerFn } from "./types.ts"` to `charter.ts`.

### Step 2: Update `iterate.ts` to use `runCharterCheck`

Replace lines 259–284 in `iterate()` with a call to the shared function:

```typescript
// Add to imports at top:
import { runCharterCheck } from "./charter.ts";

// Replace the charter check block:
let charterCheckResult: CharterCheckResult | null = null;
if (!skipCharter) {
  const failure = await runCharterCheck(folder, config.minCharterLength, charterChecker, onProgress);
  if (failure) {
    return {
      name: "",
      assessment: "",
      plan: "",
      execution: "",
      gatesResult: null,
      retries: 0,
      success: false,
      structuredAssessment: null,
      triageResult: null,
      charterCheck: failure,
      skippedReason: "Charter clarity insufficient",
    };
  }
}
```

Remove the existing `import { checkCharter } from "./charter.ts"` since `iterate()` no longer calls `checkCharter` directly (it's injected via `charterChecker`). Actually — check: `iterate.ts` imports `checkCharter` as the default for the `charterChecker` parameter. The default must remain. So the import stays, and we add `runCharterCheck` to the import.

**Exact import change:** `import { checkCharter } from "./charter.ts"` → `import { checkCharter, runCharterCheck } from "./charter.ts"`

### Step 3: Update `github-iterate.ts` to use `runCharterCheck`

Replace lines 298–310 in `githubIterate()` with a call to the shared function:

```typescript
// Add to imports at top:
import { runCharterCheck } from "./charter.ts";
// Remove: import { checkCharter } from "./charter.ts";

// Replace the charter check block:
if (!skipCharter) {
  const failure = await runCharterCheck(folder, config.minCharterLength, charterChecker, onProgress);
  if (failure) {
    throw new Error("Charter clarity insufficient");
  }
}
```

Wait — `github-iterate.ts` also imports `checkCharter` as the default for the `charterChecker` option. So again: keep `checkCharter`, add `runCharterCheck`.

**Exact import change:** `import { checkCharter } from "./charter.ts"` → `import { checkCharter, runCharterCheck } from "./charter.ts"`

### Step 4: Add tests for `runCharterCheck` in `charter.test.ts`

Add a new `describe("runCharterCheck")` block to the existing `charter.test.ts` with these test cases:

1. **Passing check returns null and reports progress** — Verify that when the checker returns `{ passed: true }`, the function returns `null` and calls `onProgress` with "Checking..." and "Charter check passed." messages.

2. **Failing check returns the result and reports guidance** — Verify that when the checker returns `{ passed: false, guidance: [...] }`, the function returns the result and calls `onProgress` with "Charter clarity insufficient." and each guidance line prefixed with `  → `.

3. **Delegates to the provided checker function** — Verify the checker is called with the correct `folder` and `minLength` arguments.

These tests use the existing `passingCharterChecker` and `failingCharterChecker` from `test-helpers.ts`.

### Step 5: Verify existing tests still pass

Run `bun test` to confirm all 236 tests pass. The behavior of both `iterate()` and `githubIterate()` is unchanged — only the internal implementation is consolidated. The existing tests for:

- `iterate.test.ts`: "charter fails → early return, no Claude calls" 
- `iterate.test.ts`: "skipCharter: true → charter checker not called"
- `github-iterate.test.ts`: "charter fails → throws error"

...all exercise the same external behavior and should pass without modification.

### Step 6: Run type check

Run `bunx tsc --noEmit` to confirm zero type errors.

### Summary of changes

| File | Change |
|------|--------|
| `src/charter.ts` | Add `runCharterCheck` function (~15 lines) |
| `src/iterate.ts` | Replace inline charter check with call to `runCharterCheck` (net reduction ~5 lines) |
| `src/github-iterate.ts` | Replace inline charter check with call to `runCharterCheck` (net reduction ~5 lines) |
| `src/charter.test.ts` | Add tests for `runCharterCheck` (~30 lines) |

**What doesn't change:** `types.ts`, `test-helpers.ts`, `iterate.test.ts`, `github-iterate.test.ts`, any command handlers.

**One message slightly changes:** The GitHub mode's progress message was `"Charter clarity insufficient. Cannot proceed in GitHub mode."` while local mode had `"Charter clarity insufficient."`. The shared function normalizes to `"Charter clarity insufficient."` — the mode-specific context isn't needed because the thrown error or returned result already communicates the mode-specific consequence. If this normalization is undesirable, the function could accept a custom failure message, but that adds unnecessary complexity for no behavioral benefit.