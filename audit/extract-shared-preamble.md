Now I have a thorough understanding of the codebase. Let me formulate my assessment.

```json
{ "severity": 3, "principle": "No Knowledge Duplication", "category": "architecture" }
```

## Assessment: Duplicated Pipeline Preamble Between Local and GitHub Modes

### What I Found

The **charter check** and **preflight gate validation** sequences are duplicated across `iterate.ts` (local mode) and `github-iterate.ts` (GitHub mode). These represent the same business decision — "verify project readiness before doing LLM work" — expressed in two places that must change together for the same reason.

**In `iterate.ts` (lines 257-311):**
```typescript
// --- Charter check ---
if (!skipCharter) {
  onProgress("charter", "Checking project charter clarity...");
  charterCheckResult = await charterChecker(folder, config.minCharterLength);
  if (!charterCheckResult.passed) {
    onProgress("charter", "Charter clarity insufficient.");
    for (const g of charterCheckResult.guidance) {
      onProgress("charter", `  → ${g}`);
    }
    return { /* early return with failure */ };
  }
  onProgress("charter", "Charter check passed.");
}

// --- Preflight gate validation ---
if (!skipGates) {
  onProgress("preflight", "Resolving quality gates...");
  preflightGates = await gateResolver(folder, agent, config.models.gates, ...);
  if (preflightGates.length > 0) {
    onProgress("preflight", "Running preflight gate check...");
    const preflightResult = await gateRunner(preflightGates, folder, config.gateTimeout);
    if (!preflightResult.requiredPassed) {
      onProgress("preflight", "Preflight failed...");
      return { /* early return with failure */ };
    }
    onProgress("preflight", "Preflight passed.");
  }
}
```

**In `github-iterate.ts` (lines 294-324):**
```typescript
// --- Charter check ---
if (!skipCharter) {
  onProgress("charter", "Checking project charter clarity...");
  const charterResult = await charterChecker(folder, config.minCharterLength);
  if (!charterResult.passed) {
    onProgress("charter", "Charter clarity insufficient. Cannot proceed in GitHub mode.");
    for (const g of charterResult.guidance) {
      onProgress("charter", `  → ${g}`);
    }
    throw new Error("Charter clarity insufficient");
  }
  onProgress("charter", "Charter check passed.");
}

// --- Preflight gate validation ---
if (!skipGates) {
  onProgress("preflight", "Resolving quality gates...");
  preflightGates = await gateResolver(folder, agent, config.models.gates, ...);
  if (preflightGates.length > 0) {
    onProgress("preflight", "Running preflight gate check...");
    const preflightResult = await gateRunner(preflightGates, folder, config.gateTimeout);
    if (!preflightResult.requiredPassed) {
      onProgress("preflight", "Preflight failed...");
      throw new Error("Preflight failed...");
    }
    onProgress("preflight", "Preflight passed.");
  }
}
```

The logic is **structurally identical** — the only difference is how failure is signaled:
- Local mode returns an `IterationResult` with `success: false` and a `skippedReason`
- GitHub mode throws an `Error`

This is knowledge duplication: both files encode the same pipeline preamble rules (which checks to run, in what order, with what progress messages). If you added a new pre-assessment check (e.g., validating the agent file exists and is well-formed), you'd need to add it in both places and test it in both places.

Additionally, the `IterateOptions` and `GitHubIterateOptions` interfaces share the same set of injectable dependency fields (`gateRunner`, `gateResolver`, `charterChecker`, `triageRunner`, `skipGates`, `skipCharter`, `skipTriage`, `onProgress`), further reinforcing that these are the same concept expressed twice.

### Why This Matters (Severity: 3)

This is **moderate** — not critical. The code works correctly, tests are comprehensive, and the duplication is contained to two specific files. But it creates real risk:

1. **Silent divergence** — The error messages already differ slightly (`"Charter clarity insufficient."` vs `"Charter clarity insufficient. Cannot proceed in GitHub mode."`). Over time, bug fixes applied to one path might not reach the other.

2. **Testing burden** — Both `iterate.test.ts` and `github-iterate.test.ts` independently test charter failure and preflight failure. These are testing the same decision twice.

3. **Extension friction** — Adding new preamble steps (agent validation, config validation, new checks) requires changes in both files.

### Recommended Correction

Extract a shared `runPreamble()` function that encapsulates the charter check and preflight gate validation. The function returns a discriminated union or result type that lets each caller handle failure in its own way (return vs throw):

```typescript
// New file: src/preamble.ts
export interface PreambleResult {
  passed: boolean;
  charterCheck: CharterCheckResult | null;
  gates: GateDefinition[];
  failureReason?: string;
  gatesResult?: GatesRunResult;
}

export async function runPreamble(opts: {
  folder: string;
  agent: string;
  config: HoneConfig;
  skipCharter: boolean;
  skipGates: boolean;
  gateResolver: GateResolverFn;
  gateRunner: GateRunner;
  charterChecker: CharterCheckerFn;
  claude: ClaudeInvoker;
  onProgress: (stage: string, message: string) => void;
}): Promise<PreambleResult> {
  // Charter check (once)
  // Preflight gate validation (once)
  // Return structured result
}
```

Then both `iterate()` and `githubIterate()` call `runPreamble()` and handle the result according to their error reporting strategy. The preamble logic exists in one place, tested once, extended once.

This also naturally consolidates the shared fields from `IterateOptions` and `GitHubIterateOptions` into the `PreambleOptions` type, reducing interface duplication.

### What NOT to Do

- Don't create a shared abstract class — composition is better here
- Don't unify `iterate()` and `githubIterate()` into one function with a mode flag — they have legitimately different post-preamble workflows
- Don't extract more than the preamble — the assess/name/plan/execute stages are already shared via the exported stage functions from `iterate.ts`, and `github-iterate.ts` already imports them

### Other Observations (Not the Primary Violation)

The codebase is in **good shape** overall. A few minor items I noticed but didn't rank as the most violated principle:

- **Non-null assertions** (`!`) used in a few places (`args[0]!`, `match[0]!`, `match[1]!`) — these are low-risk in context since the surrounding logic guards them, but `??` with a thrown error would be more explicit
- **`closeRejectedIssues` mutates its input** (line 83: `issue.reactions = reactions`) — this side effect is surprising for a function that sounds like it only closes things
- **`parseGatesJson` uses `Record<string, unknown>` casts** in its type guard — a Zod schema would be cleaner here, but the project deliberately avoids external dependencies

The knowledge duplication in the preamble is the most impactful issue to address because it's the one most likely to cause a real bug during future development.