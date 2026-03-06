Good — `github-iterate.ts` already delegates to `runExecuteWithVerify` from `iterate.ts`. The duplication is specifically between `iterate.ts`'s `runExecuteWithVerify` and `maintain.ts`'s inline verify loop. Now I have everything I need.

---

## Step-by-Step Plan

### Overview

Extract the duplicated verify-and-retry loop from `iterate.ts` (`runExecuteWithVerify` lines 231–278) and `maintain.ts` (lines 172–214) into a shared `verifyWithRetry` function in a new module. Move the duplicated `AttemptRecord` type to `types.ts`. Both callers will delegate to the shared function, each passing their own retry prompt builder.

### Step 1: Move `AttemptRecord` to `types.ts`

**File:** `src/types.ts`

Add the following type definition (currently independently defined in both `iterate.ts` line 45–48 and `maintain.ts` line 44–47):

```typescript
export type AttemptRecord = {
  attempt: number;
  failedGates: { name: string; output: string }[];
};
```

This is a single shared definition for the concept "a record of one retry attempt and which gates failed."

### Step 2: Create `src/verify-loop.ts` with the shared `verifyWithRetry` function

**File:** `src/verify-loop.ts` (new file)

Extract the inner enforcement loop into a standalone function. This function encapsulates:
- The `for` loop over attempts (0 to maxRetries)
- Re-reading `.hone-gates.json` via `loadOverrideGates`
- Running gates via the provided gate runner
- Checking `requiredPassed` to break on success
- Checking attempt count to break on exhaustion
- Collecting failed gate output
- Calling the provided `buildRetryPrompt` callback
- Invoking Claude with retry args via `buildClaudeArgs`
- Saving retry audit artifacts via `saveStageOutput`
- Tracking `AttemptRecord[]` and retry count
- Reporting progress via `onProgress`

The function signature should be:

```typescript
import { buildClaudeArgs } from "./claude.ts";
import { saveStageOutput } from "./audit.ts";
import { loadOverrideGates } from "./resolve-gates.ts";
import type {
  GateDefinition,
  GatesRunResult,
  ClaudeInvoker,
  GateRunner,
  AttemptRecord,
} from "./types.ts";

export type RetryPromptBuilder = (
  failedGates: { name: string; output: string }[],
  priorAttempts: AttemptRecord[],
) => string;

export interface VerifyWithRetryOpts {
  gates: GateDefinition[];
  gateRunner: GateRunner;
  maxRetries: number;
  gateTimeout: number;
  executeModel: string;
  readOnlyTools: string;
  agent: string;
  folder: string;
  auditDir: string;
  name: string;
  claude: ClaudeInvoker;
  buildRetryPrompt: RetryPromptBuilder;
  onProgress: (stage: string, message: string) => void;
}

export interface VerifyWithRetryResult {
  gatesResult: GatesRunResult | null;
  retries: number;
  execution: string;
}

export async function verifyWithRetry(
  initialExecution: string,
  opts: VerifyWithRetryOpts,
): Promise<VerifyWithRetryResult>
```

The implementation body is the loop currently at `iterate.ts` lines 232–278 (and duplicated at `maintain.ts` lines 172–214):

```typescript
export async function verifyWithRetry(
  initialExecution: string,
  opts: VerifyWithRetryOpts,
): Promise<VerifyWithRetryResult> {
  const {
    gates, gateRunner, maxRetries, gateTimeout, executeModel, readOnlyTools,
    agent, folder, auditDir, name, claude, buildRetryPrompt, onProgress,
  } = opts;

  let execution = initialExecution;
  let gatesResult: GatesRunResult | null = null;
  let retries = 0;
  const attempts: AttemptRecord[] = [];

  if (gates.length === 0) {
    onProgress("verify", "No quality gates found.");
  }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const currentGates = (await loadOverrideGates(folder)) ?? gates;
    onProgress("verify", `Running quality gates (attempt ${attempt + 1})...`);
    gatesResult = await gateRunner(currentGates, folder, gateTimeout);

    if (gatesResult.requiredPassed) {
      onProgress("verify", "All required gates passed.");
      break;
    }

    if (attempt === maxRetries) {
      onProgress("verify", `Required gates still failing after ${maxRetries} retries.`);
      break;
    }

    const failedGates = gatesResult.results
      .filter((r) => !r.passed && r.required)
      .map((r) => ({ name: r.name, output: r.output }));

    const retryPrompt = buildRetryPrompt(failedGates, attempts);
    retries = attempt + 1;

    attempts.push({ attempt: retries, failedGates });

    onProgress("execute", `Retry ${retries}: fixing gate failures...`);
    const retryArgs = buildClaudeArgs({
      agent,
      model: executeModel,
      prompt: retryPrompt,
      readOnly: false,
      readOnlyTools,
    });
    execution = await claude(retryArgs);

    const retryPath = await saveStageOutput(auditDir, name, `retry-${retries}-actions`, execution);
    onProgress("execute", `Saved: ${retryPath}`);
  }

  return { gatesResult, retries, execution };
}
```

Note: The "No quality gates found" message is only emitted in `iterate.ts` (not `maintain.ts`, which requires gates to proceed). We include it here since it's harmless and the condition (`gates.length === 0`) will simply never be true in the maintain path. Alternatively, we could remove it and let callers handle the empty-gates message — but since `iterate.ts` checks it inside the verify section, keeping it here preserves existing behavior.

### Step 3: Refactor `runExecuteWithVerify` in `iterate.ts` to delegate to `verifyWithRetry`

**File:** `src/iterate.ts`

1. Add import: `import { verifyWithRetry } from "./verify-loop.ts";`
2. Change the import of `AttemptRecord` to come from `types.ts`: `import type { ..., AttemptRecord } from "./types.ts";`
3. Remove the local `type AttemptRecord` definition (lines 45–48).
4. Remove the `import { loadOverrideGates } from "./resolve-gates.ts"` (only needed if nothing else in iterate.ts uses it — check: `loadOverrideGates` is only used in the verify loop, so remove it from the import).
5. Replace the verify inner loop (lines 232–278) inside `runExecuteWithVerify` with a call to `verifyWithRetry`:

```typescript
export async function runExecuteWithVerify(
  agent: string,
  folder: string,
  assessment: string,
  plan: string,
  config: HoneConfig,
  claude: ClaudeInvoker,
  opts: {
    skipGates: boolean;
    gateRunner: GateRunner;
    gates: GateDefinition[];
    auditDir: string;
    name: string;
    onProgress: (stage: string, message: string) => void;
  },
): Promise<{
  execution: string;
  gatesResult: GatesRunResult | null;
  retries: number;
  success: boolean;
}> {
  const { skipGates, gateRunner, gates, auditDir, name, onProgress } = opts;

  // Execute
  onProgress("execute", "Executing plan...");
  const executeArgs = buildClaudeArgs({
    agent,
    model: config.models.execute,
    prompt: [
      `Execute the following plan to improve the project in ${folder}.`,
      "",
      "Why:",
      assessment,
      "",
      "Plan:",
      plan,
    ].join("\n"),
    readOnly: false,
    readOnlyTools: config.readOnlyTools,
  });
  let execution = await claude(executeArgs);

  const actionsPath = await saveStageOutput(auditDir, name, "actions", execution);
  onProgress("execute", `Saved: ${actionsPath}`);

  // Verify (inner loop)
  let gatesResult: GatesRunResult | null = null;
  let retries = 0;

  if (!skipGates) {
    const verifyResult = await verifyWithRetry(execution, {
      gates,
      gateRunner,
      maxRetries: config.maxRetries,
      gateTimeout: config.gateTimeout,
      executeModel: config.models.execute,
      readOnlyTools: config.readOnlyTools,
      agent,
      folder,
      auditDir,
      name,
      claude,
      buildRetryPrompt: (failedGates, priorAttempts) =>
        buildRetryPrompt(folder, plan, assessment, failedGates, priorAttempts),
      onProgress,
    });
    gatesResult = verifyResult.gatesResult;
    retries = verifyResult.retries;
    execution = verifyResult.execution;
  }

  const success = skipGates || (gatesResult?.requiredPassed ?? true);
  return { execution, gatesResult, retries, success };
}
```

The `buildRetryPrompt` function (lines 50–101) stays in `iterate.ts` as-is — it's the iterate-specific prompt builder and is also exported for direct testing. We just close over `folder`, `plan`, and `assessment` in the callback.

### Step 4: Refactor `maintain.ts` to delegate to `verifyWithRetry`

**File:** `src/maintain.ts`

1. Add import: `import { verifyWithRetry } from "./verify-loop.ts";`
2. Remove the `import { loadOverrideGates } from "./resolve-gates.ts"` line (only used in the verify loop).
3. Remove the local `type AttemptRecord` definition (lines 44–47).
4. Import `AttemptRecord` from `types.ts` if `buildMaintainRetryPrompt` still needs the type in its signature — check: yes, the function signature uses `AttemptRecord[]` in its parameter. Add it to the import from `types.ts`.
5. Replace the verify inner loop (lines 172–214) with a call to `verifyWithRetry`:

In the `maintain` function, after saving the initial execution (line 170), replace lines 172–214 with:

```typescript
  // Verify (inner loop)
  const verifyResult = await verifyWithRetry(execution, {
    gates,
    gateRunner,
    maxRetries: config.maxRetries,
    gateTimeout: config.gateTimeout,
    executeModel: config.models.execute,
    readOnlyTools: config.readOnlyTools,
    agent,
    folder,
    auditDir,
    name,
    claude,
    buildRetryPrompt: (failedGates, priorAttempts) =>
      buildMaintainRetryPrompt(folder, gates, failedGates, priorAttempts),
    onProgress,
  });

  const { gatesResult, retries } = verifyResult;
  execution = verifyResult.execution;
  const success = gatesResult?.requiredPassed ?? false;
```

Note: `maintain.ts` does NOT have a `skipGates` path (it requires gates), so we call `verifyWithRetry` unconditionally. The "No quality gates found" message in `verifyWithRetry` is fine since `maintain` already guards against `gates.length === 0` earlier and returns.

### Step 5: Update `buildMaintainRetryPrompt` signature to use shared `AttemptRecord`

**File:** `src/maintain.ts`

The function `buildMaintainRetryPrompt` (lines 49–98) currently references the local `AttemptRecord` type. After removing the local definition (Step 4), ensure the import from `types.ts` is in place. The function's signature and body remain unchanged — only the type's source changes.

### Step 6: Write tests for `verifyWithRetry`

**File:** `src/verify-loop.test.ts` (new file)

Write focused unit tests for the extracted function. These should cover:

1. **All gates pass on first attempt** — returns `retries: 0`, `gatesResult.requiredPassed: true`, original execution string.

2. **Required gate fails, retry succeeds** — returns `retries: 1`, `gatesResult.requiredPassed: true`, the retry execution string, and verifies `buildRetryPrompt` callback was called with failed gates and empty prior attempts.

3. **Max retries exhausted** — returns `retries: maxRetries`, `gatesResult.requiredPassed: false`, and verifies all retry attempts were made.

4. **No gates (empty array)** — returns `gatesResult: null` or the runner result with zero gates. Verify the "No quality gates found" progress message is emitted.

5. **Retry prompt builder receives cumulative prior attempts** — On the second retry, verify the callback receives the first attempt's failures in `priorAttempts`.

6. **Agent updates `.hone-gates.json` mid-loop** — Mock `loadOverrideGates` to return different gates after the first attempt. Verify the new gates are passed to the gate runner.

7. **Audit files saved for each retry** — Verify `saveStageOutput` is called with `retry-1-actions`, `retry-2-actions`, etc.

For these tests, use dependency injection via the `opts` parameter. The `gateRunner`, `claude`, `buildRetryPrompt`, and `onProgress` are all injectable. The only hidden dependency is `loadOverrideGates` (module-level import) and `saveStageOutput` — these can be tested through integration (using temp dirs) or by verifying side effects (file existence, progress messages).

Use the same temp directory pattern as existing tests (`mkdtemp` + `rm` in `finally`).

### Step 7: Verify existing tests still pass

Run:
```bash
bun test
```

All existing tests in `iterate.test.ts`, `maintain.test.ts`, and `github-iterate.test.ts` should continue to pass without modification, since:

- `runExecuteWithVerify` maintains the same signature and behavior
- `maintain` maintains the same signature and behavior  
- `buildRetryPrompt` and `buildMaintainRetryPrompt` remain exported with the same signatures
- The test helpers (`createIterateMock`, `createMaintainMock`, `createPreflightAwareGateRunner`) are unchanged

### Step 8: Run type checker

```bash
bunx tsc --noEmit
```

Verify zero type errors. Key things to check:
- `AttemptRecord` export from `types.ts` is imported correctly in all three files
- `verifyWithRetry` return type matches usage in both `iterate.ts` and `maintain.ts`
- No unused imports remain in `iterate.ts` or `maintain.ts` after removing `loadOverrideGates`

### Step 9: Build and verify

```bash
bun build src/cli.ts --compile --outfile=build/hone
./build/hone --version
```

### Step 10: Run security scan

```bash
osv-scanner .
```

### Summary of changes

| File | Change |
|------|--------|
| `src/types.ts` | Add `AttemptRecord` type export |
| `src/verify-loop.ts` | **New** — shared `verifyWithRetry` function + types |
| `src/verify-loop.test.ts` | **New** — unit tests for the shared function |
| `src/iterate.ts` | Remove local `AttemptRecord`, remove `loadOverrideGates` import, replace verify loop with `verifyWithRetry` call |
| `src/maintain.ts` | Remove local `AttemptRecord`, remove `loadOverrideGates` import, replace verify loop with `verifyWithRetry` call, import `AttemptRecord` from types |

**Not changed:** `buildRetryPrompt` (iterate.ts), `buildMaintainRetryPrompt` (maintain.ts), `github-iterate.ts`, test helpers, any command handlers. The prompt builders remain where they are — they represent intentionally different decisions about what context to include in retry prompts, and they're well-tested in place.

**Lines eliminated:** ~40 lines of duplicated loop logic in `maintain.ts`, replaced by ~5 lines delegating to the shared function. Net new code is the `verify-loop.ts` module (~60 lines) and its tests.