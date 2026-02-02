Now I have a thorough understanding of the codebase. Here is the complete plan:

---

## Plan: Extract Shared Proposal Pipeline to Eliminate Knowledge Duplication

### Problem Summary

The assess→name→triage→plan pipeline is duplicated in `src/iterate.ts` (lines 259–337) and `src/github-iterate.ts` (lines 211–260). The two copies have already diverged: charter failure returns `IterationResult` with `success: false` in local mode but throws an `Error` in GitHub mode; triage details are captured on the result in local mode but discarded to a counter in GitHub mode. Adding a new pipeline stage or changing the assessment prompt requires updating both locations in lockstep.

### Step-by-Step Plan

---

#### Step 1: Define the `ProposeResult` discriminated union and `Proposal` type in `src/types.ts`

Add the following types to `src/types.ts`:

```typescript
/** A successfully produced proposal — ready for execution or issue creation. */
export interface Proposal {
  name: string;
  assessment: string;
  structuredAssessment: StructuredAssessment;
  plan: string;
  auditDir: string;
}

/** Discriminated union for all possible proposal pipeline outcomes. */
export type ProposeResult =
  | { outcome: "proposed"; proposal: Proposal; triageResult: TriageResult | null }
  | { outcome: "triageRejected"; name: string; assessment: string; structuredAssessment: StructuredAssessment; triageResult: TriageResult }
  | { outcome: "charterFailed"; charterCheck: CharterCheckResult };
```

These types make the three possible pipeline outcomes explicit and type-safe. A consumer switches on `outcome` rather than checking multiple nullable fields.

---

#### Step 2: Define the `ProposeOptions` interface in `src/types.ts`

Add an options interface that captures the shared dependencies for the proposal pipeline:

```typescript
export interface ProposeOptions {
  agent: string;
  folder: string;
  config: HoneConfig;
  skipCharter: boolean;
  skipTriage: boolean;
  charterChecker: CharterCheckerFn;
  triageRunner: TriageRunnerFn;
  onProgress: (stage: string, message: string) => void;
}
```

This replaces the overlapping subsets of `IterateOptions` and `GitHubIterateOptions` that serve the proposal pipeline.

---

#### Step 3: Create `src/propose.ts` with the extracted `propose()` function

Create a new file `src/propose.ts` containing:

```typescript
import { ensureAuditDir, saveStageOutput } from "./audit.ts";
import { parseAssessment } from "./parse-assessment.ts";
import { runAssessStage, runNameStage, runPlanStage } from "./iterate.ts";
import type { ClaudeInvoker, ProposeOptions, ProposeResult } from "./types.ts";

export async function propose(
  opts: ProposeOptions,
  claude: ClaudeInvoker,
): Promise<ProposeResult> {
  const {
    agent,
    folder,
    config,
    skipCharter,
    skipTriage,
    charterChecker,
    triageRunner,
    onProgress,
  } = opts;

  // --- Charter check ---
  if (!skipCharter) {
    onProgress("charter", "Checking project charter clarity...");
    const charterCheck = await charterChecker(folder, config.minCharterLength);
    if (!charterCheck.passed) {
      onProgress("charter", "Charter clarity insufficient.");
      for (const g of charterCheck.guidance) {
        onProgress("charter", `  → ${g}`);
      }
      return { outcome: "charterFailed", charterCheck };
    }
    onProgress("charter", "Charter check passed.");
  }

  const auditDir = await ensureAuditDir(folder, config.auditDir);

  // --- Stage 1: Assess ---
  onProgress("assess", `Assessing ${folder} with ${agent}...`);
  const assessment = await runAssessStage(agent, folder, config, claude);
  const structuredAssessment = parseAssessment(assessment);

  // --- Stage 2: Name ---
  onProgress("name", "Generating filename...");
  const name = await runNameStage(agent, assessment, config, claude);

  // Save assessment
  const assessPath = await saveStageOutput(auditDir, name, "", assessment);
  onProgress("assess", `Saved: ${assessPath}`);

  // --- Stage 3: Triage ---
  let triageResult = null;
  if (!skipTriage) {
    onProgress("triage", "Running triage...");
    triageResult = await triageRunner(
      structuredAssessment,
      config.severityThreshold,
      config.models.triage,
      config.readOnlyTools,
      claude,
    );

    if (!triageResult.accepted) {
      onProgress("triage", `Triage rejected: ${triageResult.reason}`);
      return {
        outcome: "triageRejected",
        name,
        assessment,
        structuredAssessment,
        triageResult,
      };
    }
    onProgress("triage", "Triage accepted.");
  }

  // --- Stage 4: Plan ---
  onProgress("plan", "Creating plan...");
  const plan = await runPlanStage(agent, assessment, config, claude);

  const planPath = await saveStageOutput(auditDir, name, "plan", plan);
  onProgress("plan", `Saved: ${planPath}`);

  return {
    outcome: "proposed",
    proposal: { name, assessment, structuredAssessment, plan, auditDir },
    triageResult,
  };
}
```

This function encapsulates the entire charter→assess→name→triage→plan pipeline in one place. Both `iterate()` and `githubIterate()` will call it.

---

#### Step 4: Rewrite `iterate()` in `src/iterate.ts` to use `propose()`

Replace the charter check, assess, name, triage, and plan stages in `iterate()` with a single `propose()` call. The function becomes:

```typescript
export async function iterate(
  opts: IterateOptions,
  claude: ClaudeInvoker,
): Promise<IterationResult> {
  const {
    agent,
    folder,
    config,
    skipGates,
    skipCharter = false,
    skipTriage = false,
    gateRunner = runAllGates,
    gateResolver = resolveGates,
    charterChecker = checkCharter,
    triageRunner = runTriage,
    onProgress,
  } = opts;

  const proposeResult = await propose(
    { agent, folder, config, skipCharter, skipTriage, charterChecker, triageRunner, onProgress },
    claude,
  );

  if (proposeResult.outcome === "charterFailed") {
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
      charterCheck: proposeResult.charterCheck,
      skippedReason: "Charter clarity insufficient",
    };
  }

  if (proposeResult.outcome === "triageRejected") {
    return {
      name: proposeResult.name,
      assessment: proposeResult.assessment,
      plan: "",
      execution: "",
      gatesResult: null,
      retries: 0,
      success: true,
      structuredAssessment: proposeResult.structuredAssessment,
      triageResult: proposeResult.triageResult,
      charterCheck: null,
      skippedReason: `Triage: ${proposeResult.triageResult.reason}`,
    };
  }

  // outcome === "proposed"
  const { proposal, triageResult } = proposeResult;

  const execResult = await runExecuteWithVerify(
    agent, folder, proposal.assessment, proposal.plan, config, claude,
    {
      skipGates,
      gateRunner,
      gateResolver,
      auditDir: proposal.auditDir,
      name: proposal.name,
      onProgress,
    },
  );

  onProgress(
    "done",
    execResult.success
      ? `Complete: ${proposal.name}`
      : `Incomplete: ${proposal.name} (gate failures remain)`,
  );

  return {
    name: proposal.name,
    assessment: proposal.assessment,
    plan: proposal.plan,
    execution: execResult.execution,
    gatesResult: execResult.gatesResult,
    retries: execResult.retries,
    success: execResult.success,
    structuredAssessment: proposal.structuredAssessment,
    triageResult,
    charterCheck: null,
    skippedReason: null,
  };
}
```

Remove the now-unused imports from `iterate.ts`: `checkCharter`, `parseAssessment`, `triage as runTriage`, and their associated type imports that are no longer directly referenced. Keep the stage functions (`runAssessStage`, `runNameStage`, `runPlanStage`) exported since `propose.ts` imports them.

---

#### Step 5: Rewrite the proposal loop in `githubIterate()` to use `propose()`

Replace the propose section in `src/github-iterate.ts` (lines 211–261) with:

```typescript
  // --- Propose new improvements ---
  onProgress("propose", `Generating up to ${proposals} proposal(s)...`);

  for (let i = 0; i < proposals; i++) {
    onProgress("propose", `Proposal ${i + 1}/${proposals}: assessing...`);

    const proposeResult = await propose(
      { agent, folder, config, skipCharter: true, skipTriage, charterChecker, triageRunner, onProgress },
      claude,
    );

    if (proposeResult.outcome === "charterFailed") {
      // Charter was already checked above; this shouldn't happen with skipCharter: true
      break;
    }

    if (proposeResult.outcome === "triageRejected") {
      onProgress("propose", `Proposal ${i + 1}/${proposals}: triage rejected — ${proposeResult.triageResult.reason}`);
      result.skippedTriage++;
      continue;
    }

    // outcome === "proposed"
    const { proposal } = proposeResult;

    const issueBody = formatIssueBody({
      assessment: proposal.assessment,
      plan: proposal.plan,
      agent,
      severity: proposal.structuredAssessment.severity,
      principle: proposal.structuredAssessment.principle,
    });

    const issueTitle = `[Hone] ${proposal.structuredAssessment.principle}: ${proposal.name}`;
    const issueNumber = await createHoneIssue(folder, issueTitle, issueBody, ghRunner);

    onProgress("propose", `Created issue #${issueNumber}: ${issueTitle}`);
    result.proposed.push(issueNumber);
  }
```

Also replace the charter check at the top of `githubIterate()` (lines 88–99) with a `propose`-compatible pattern. Since GitHub mode does charter check once before the loop (not per-proposal), keep the early charter check but use the same `charterChecker` function — the charter check in the proposal loop is skipped via `skipCharter: true`.

The charter check at the top of `githubIterate()` should remain as-is but change from throwing `Error` to returning a result, for consistency. However, since `githubIterate()` returns `GitHubIterateResult` and the existing callers expect a thrown error, we'll keep the throw behavior for now. The important change is that the **proposal pipeline** is now unified. The charter check divergence at the top-level is a separate concern (GitHub mode needs to fail-fast before housekeeping).

Remove the now-unused direct imports from `github-iterate.ts`: `parseAssessment`, `runAssessStage`, `runNameStage`, `runPlanStage`, and `ensureAuditDir` (for the proposal section — `ensureAuditDir` is still used by the execution section). Actually, `ensureAuditDir` is still needed for the execution section, so keep it. Remove `parseAssessment`, `triage as runTriageDefault`. Keep `runExecuteWithVerify` since it's still used for executing approved issues.

---

#### Step 6: Create `src/propose.test.ts` — unit tests for the extracted `propose()` function

Write tests that cover each outcome of the discriminated union:

1. **Charter fails → returns `charterFailed` outcome** — Verify no Claude calls are made, verify the `charterCheck` data is present.

2. **Triage rejects (severity) → returns `triageRejected` outcome** — Verify only assess + name calls (2 total), verify `triageResult` is present with `accepted: false`.

3. **Triage rejects (busy-work) → returns `triageRejected` outcome** — Same structure, verifies `busyWork: true`.

4. **Full pipeline success → returns `proposed` outcome** — Verify 4 Claude calls (assess, name, triage-via-runner, plan), verify `proposal` has all fields populated, verify audit files were created.

5. **Skip charter → charter checker not called** — Pass `skipCharter: true`, verify the charter function was not invoked.

6. **Skip triage → triage runner not called, goes straight to plan** — Pass `skipTriage: true`, verify 3 Claude calls (assess, name, plan).

Use the existing `createIterateMock` and shared test helpers from `src/test-helpers.ts`.

---

#### Step 7: Update existing tests in `src/iterate.test.ts`

The existing `iterate()` tests should continue to pass without changes because `iterate()` still has the same public API and returns the same `IterationResult` type. Run all tests to confirm.

If any tests break due to import changes, fix the imports. The tests test `iterate()` behavior, which internally now delegates to `propose()` — but from the test's perspective nothing changed.

---

#### Step 8: Update existing tests in `src/github-iterate.test.ts`

Similarly, the existing `githubIterate()` tests should pass without changes since the public API is preserved. Run all tests to confirm.

The key behavioral differences to verify:
- "charter fails → throws error" test should still pass (charter check at top of `githubIterate()` still throws)
- "triage rejects proposal → skipped, counter incremented" test should still pass
- "--proposals 3 → up to 3 proposals created" test should still pass

---

#### Step 9: Update `src/iterate.ts` imports — clean up unused imports

After the refactor, `src/iterate.ts` should:
- **Remove** imports: `checkCharter`, `parseAssessment`, `triage as runTriage`
- **Remove** type imports no longer directly referenced: `CharterCheckResult`, `StructuredAssessment`, `TriageResult`, `CharterCheckerFn`, `TriageRunnerFn` (if they're only needed by `propose.ts` now)
- **Add** import: `propose` from `./propose.ts`
- **Keep**: `buildClaudeArgs`, `ensureAuditDir`, `saveStageOutput`, `runAllGates`, `resolveGates`, and the stage functions (`runAssessStage`, `runNameStage`, `runPlanStage`, `runExecuteWithVerify`) since they're still used or exported

Wait — `IterateOptions` still declares `charterChecker`, `triageRunner` etc. as optional fields, so those type imports are still needed in `iterate.ts` for the `IterateOptions` interface. Keep the type imports but remove the value imports (`checkCharter`, `triage as runTriage`). The defaults for `charterChecker` and `triageRunner` in `iterate()`'s destructuring need to stay since `iterate()` passes them to `propose()`.

Actually, let me reconsider. `iterate()` still needs default values for `charterChecker` and `triageRunner` to pass to `propose()`. So `iterate.ts` still needs to import `checkCharter` and `triage as runTriage` for the defaults. The imports don't change much — what changes is that `iterate.ts` no longer *calls* `parseAssessment` directly. Remove only the `parseAssessment` import.

---

#### Step 10: Update `src/github-iterate.ts` imports — clean up unused imports

After the refactor, `src/github-iterate.ts` should:
- **Remove** imports that the proposal loop no longer uses directly: `parseAssessment`, `runAssessStage`, `runNameStage`, `runPlanStage`
- **Remove** `saveStageOutput` if only used by the proposal section (check: `ensureAuditDir` is still used for execution of approved issues, and `saveStageOutput` is only used in the proposal loop which is now handled by `propose()`)
- **Add** import: `propose` from `./propose.ts`
- **Keep**: `ensureAuditDir` (used by approved issue execution), `runExecuteWithVerify` (used by approved issue execution), `checkCharter` and `triage as runTriageDefault` (for default values), all GitHub helpers

Actually — `ensureAuditDir` is called both in the execution section (line 141) and was called in the proposal section (line 213). With `propose()` handling the proposal section, `ensureAuditDir` is still needed for the execution section. Keep it.

`saveStageOutput` was called at line 222 and 245 in the proposal loop — both now inside `propose()`. It's no longer directly called by `github-iterate.ts`. Remove it.

---

#### Step 11: Run all quality gates

Execute the following in order:

1. `bun test` — all tests must pass (existing + new `propose.test.ts`)
2. `bunx tsc --noEmit` — zero type errors
3. `bun build src/cli.ts --compile --outfile=build/hone` — binary compiles
4. `osv-scanner .` — no new vulnerabilities (no new dependencies added)

Fix any failures before considering this complete.

---

#### Step 12: Update `CLAUDE.md` project structure to include `propose.ts`

Update the `## Project Structure` section in `CLAUDE.md` to include the new file:

```
src/
  cli.ts              # Entry point, argument parsing, help
  types.ts            # Shared type definitions
  propose.ts          # Proposal pipeline (charter→assess→name→triage→plan)
  iterate.ts          # Core iteration workflow (propose + execute + verify)
  claude.ts           # Claude CLI subprocess wrapper
  agents.ts           # Agent discovery (~/.claude/agents/)
  gates.ts            # Quality gate detection, execution, result capture
  audit.ts            # Audit output management (read/write/list)
  config.ts           # Configuration loading/defaults
  commands/
    iterate.ts        # iterate command handler
    list-agents.ts    # list-agents command handler
    gates.ts          # gates command handler
    history.ts        # history command handler
    config.ts         # config command handler
```

---

### What This Plan Does NOT Change

- **No changes to `IterationResult`** — The existing type stays as-is. It's the public API for local mode JSON output. The `ProposeResult` is an internal type used by `iterate()` and `githubIterate()` to consume proposal pipeline results. A future refactoring could make `IterationResult` a discriminated union, but that would be a separate, breaking change.

- **No changes to `GitHubIterateResult`** — Same reasoning. The `skippedTriage` counter stays; it now gets incremented when `proposeResult.outcome === "triageRejected"`.

- **No changes to the charter throw in `githubIterate()`** — The top-level charter check in GitHub mode still throws. This is the one remaining divergence between modes, and it's intentional: GitHub mode needs to fail-fast before doing housekeeping. Unifying this would require changing `GitHubIterateResult` to include a charter failure variant, which is a separate concern.

- **No changes to the stage functions** (`runAssessStage`, `runNameStage`, `runPlanStage`, `runExecuteWithVerify`) — These remain in `src/iterate.ts` and are imported by `propose.ts`. They could be moved to their own files later, but that's scope creep for this change.

- **No new dependencies** — This is pure internal refactoring.