Everything looks clean. Here's a summary of what was done:

---

## What Changed

### `src/types.ts`
Added `AttemptRecord` as a shared exported type — the single authoritative definition of "a record of one retry attempt and which gates failed."

### `src/verify-loop.ts` *(new)*
The shared inner enforcement loop extracted from both callers. Accepts an initial execution string and an `opts` object — including a `buildRetryPrompt` callback that carries the only intentional difference between `iterate` and `maintain`. One subtle fix over the original: passes `[...attempts]` (a snapshot) to the callback rather than the live array reference, making the API defensively correct.

### `src/iterate.ts`
- Removed local `AttemptRecord` type definition
- Removed `loadOverrideGates` from the `resolve-gates` import (no longer needed here)
- Replaced the ~40-line verify loop with a 15-line `verifyWithRetry` call, closing over `folder`, `plan`, and `assessment` in the retry prompt builder callback

### `src/maintain.ts`
- Same removals (`AttemptRecord`, `loadOverrideGates`)
- Replaced the ~40-line verify loop with a parallel `verifyWithRetry` call, passing `buildMaintainRetryPrompt` as the callback — keeping the intentionally different prompt wording explicit at the call site

### `src/verify-loop.test.ts` *(new)*
8 focused tests covering: pass on first attempt, fail-then-succeed retry, max-retries exhaustion, empty gates message, cumulative prior-attempts accumulation in the callback, `.hone-gates.json` override pickup, retry audit file naming, and optional-gate-only failures not triggering retries.

**Net result:** ~40 lines of duplicated loop logic eliminated, one place to evolve the retry strategy, all 345 tests green, zero type errors, clean build.