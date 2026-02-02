Now I have a thorough understanding of the codebase. Here is the complete plan:

---

## Plan: Extract Shared Proposal Pipeline to Eliminate Knowledge Duplication

### Problem

The assess → name → triage → plan pipeline is implemented twice — once in `iterate.ts` (lines 286-337) and once in `github-iterate.ts` (lines 215-261). Both follow the identical sequence: assess, parse, name, save assessment, triage (if enabled), plan, save plan. The only divergence is what happens *after* the plan is produced. Additionally, both `IterateOptions` and `GitHubIterateOptions` carry the same set of injectable dependencies (`gateRunner`, `gateResolver`, `charterChecker`, `triageRunner`, `onProgress`).

### Goal

Extract the shared pipeline into a single `buildProposal()` function and consolidate the shared dependency slots into a base interface. Both `iterate()` and `githubIterate()` will call this shared function and branch only on what to do with the result. No behavioral changes — this is a pure refactor.

---

### Step 1: Add a `PipelineDependencies` base interface to `types.ts`

Add a new interface to `src/types.ts` that captures the injectable dependencies shared between local and GitHub modes:

```typescript
export interface PipelineDependencies {
  gateRunner?: GateRunner;
  gateResolver?: GateResolverFn;
  charterChecker?: CharterCheckerFn;
  triageRunner?: TriageRunnerFn;
  onProgress: (stage: string, message: string) => void;
}
```

This interface captures exactly the five dependency slots that both `IterateOptions` and `GitHubIterateOptions` share.

---

### Step 2: Create `src/proposal.ts` with the `buildProposal()` function

Create a new module `src/proposal.ts` that extracts the assess → name → save → triage → plan → save pipeline into a single function.

**Interface:**

```typescript
export interface ProposalResult {
  name: string;
  assessment: string;
  plan: string;
  structuredAssessment: StructuredAssessment;
  triageResult: TriageResult | null;
  skipped: boolean;
  skippedReason: string | null;
}
```

**Function signature:**

```typescript
export async function buildProposal(
  agent: string,
  folder: string,
  config: HoneConfig,
  claude: ClaudeInvoker,
  opts: {
    skipTriage: boolean;
    auditDir: string;
    onProgress: (stage: string, message: string) => void;
    triageRunner: TriageRunnerFn;
  },
): Promise<ProposalResult>
```

**Function body:** Move the pipeline logic that currently exists in `iterate.ts` lines 288-337 (and is duplicated in `github-iterate.ts` lines 216-245) into this function:

1. Assess: call `runAssessStage(agent, folder, config, claude)`
2. Parse: call `parseAssessment(assessment)`
3. Name: call `runNameStage(agent, assessment, config, claude)`
4. Save assessment: call `saveStageOutput(auditDir, name, "", assessment)`
5. Triage (if `!skipTriage`): call `triageRunner(...)`, return early with `skipped: true` if rejected
6. Plan: call `runPlanStage(agent, assessment, config, claude)`
7. Save plan: call `saveStageOutput(auditDir, name, "plan", plan)`
8. Return the complete `ProposalResult` with `skipped: false`

The progress callbacks (`onProgress`) remain the same as in the current `iterate.ts` — each stage reports progress with the same stage names and messages.

This function imports `runAssessStage`, `runNameStage`, `runPlanStage` from `./iterate.ts`, `parseAssessment` from `./parse-assessment.ts`, and `saveStageOutput` from `./audit.ts`.

---

### Step 3: Update `IterateOptions` in `iterate.ts` to extend `PipelineDependencies`

Change `IterateOptions` in `src/iterate.ts` from:

```typescript
export interface IterateOptions {
  agent: string;
  folder: string;
  config: HoneConfig;
  skipGates: boolean;
  skipCharter?: boolean;
  skipTriage?: boolean;
  gateRunner?: GateRunner;
  gateResolver?: GateResolverFn;
  charterChecker?: CharterCheckerFn;
  triageRunner?: TriageRunnerFn;
  onProgress: (stage: string, message: string) => void;
}
```

To:

```typescript
export interface IterateOptions extends PipelineDependencies {
  agent: string;
  folder: string;
  config: HoneConfig;
  skipGates: boolean;
  skipCharter?: boolean;
  skipTriage?: boolean;
}
```

Import `PipelineDependencies` from `./types.ts`. This is a type-compatible change — no consumer code needs to change.

---

### Step 4: Update `GitHubIterateOptions` in `github-iterate.ts` to extend `PipelineDependencies`

Change `GitHubIterateOptions` in `src/github-iterate.ts` from:

```typescript
export interface GitHubIterateOptions {
  agent: string;
  folder: string;
  config: HoneConfig;
  proposals: number;
  skipGates: boolean;
  skipTriage: boolean;
  skipCharter?: boolean;
  onProgress: (stage: string, message: string) => void;
  ghRunner?: CommandRunner;
  gateRunner?: GateRunner;
  gateResolver?: GateResolverFn;
  charterChecker?: CharterCheckerFn;
  triageRunner?: TriageRunnerFn;
}
```

To:

```typescript
export interface GitHubIterateOptions extends PipelineDependencies {
  agent: string;
  folder: string;
  config: HoneConfig;
  proposals: number;
  skipGates: boolean;
  skipTriage: boolean;
  skipCharter?: boolean;
  ghRunner?: CommandRunner;
}
```

Import `PipelineDependencies` from `./types.ts`. Type-compatible — no consumer changes needed.

---

### Step 5: Refactor `iterate()` in `iterate.ts` to use `buildProposal()`

Replace the assess → name → triage → plan section (lines 286-337) of the `iterate()` function with a single call to `buildProposal()`:

```typescript
const auditDir = await ensureAuditDir(folder, config.auditDir);

const proposal = await buildProposal(agent, folder, config, claude, {
  skipTriage,
  auditDir,
  onProgress,
  triageRunner,
});

if (proposal.skipped) {
  return {
    name: proposal.name,
    assessment: proposal.assessment,
    plan: "",
    execution: "",
    gatesResult: null,
    retries: 0,
    success: true,
    structuredAssessment: proposal.structuredAssessment,
    triageResult: proposal.triageResult,
    charterCheck: charterCheckResult,
    skippedReason: proposal.skippedReason,
  };
}
```

Then continue with the existing execute+verify logic using `proposal.name`, `proposal.assessment`, `proposal.plan`, and `proposal.structuredAssessment` in the result.

The charter check logic at the top of `iterate()` stays where it is — it's only in `iterate.ts` with different error-handling semantics (returns result vs. throws) so it shouldn't be shared.

---

### Step 6: Refactor the proposal loop in `github-iterate.ts` to use `buildProposal()`

Replace the proposal loop body (lines 215-261) with a call to `buildProposal()`:

```typescript
for (let i = 0; i < proposals; i++) {
  onProgress("propose", `Proposal ${i + 1}/${proposals}: assessing...`);

  const proposal = await buildProposal(agent, folder, config, claude, {
    skipTriage,
    auditDir,
    onProgress,
    triageRunner,
  });

  if (proposal.skipped) {
    result.skippedTriage++;
    continue;
  }

  // Create issue (unchanged from current code)
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

Remove the now-unused direct imports of `runAssessStage`, `runNameStage`, `runPlanStage`, `parseAssessment`, and `saveStageOutput` from `github-iterate.ts` (they're still used via `proposal.ts`). Keep the import of `runExecuteWithVerify` since that's used for the execution phase.

---

### Step 7: Write tests for `buildProposal()` in `src/proposal.test.ts`

Create `src/proposal.test.ts` with tests that verify the shared pipeline in isolation:

1. **Full pipeline (triage enabled, accepted):** Verify it calls assess → name → triage → plan in order, saves audit files, returns all fields correctly with `skipped: false`.

2. **Triage rejects → returns skipped:** Verify it returns `skipped: true` with the triage rejection reason, and does NOT call plan stage.

3. **Triage skipped (`skipTriage: true`):** Verify triage is not called, pipeline proceeds directly to plan, `triageResult` is null.

4. **Progress callbacks are fired correctly:** Verify `onProgress` is called with the expected stage names at each step.

5. **Assessment and plan files are saved:** Verify audit files are created with correct names.

Use the existing `createIterateMock` and triage helpers from `test-helpers.ts`.

---

### Step 8: Verify existing tests still pass

Run `bun test` to confirm that all existing tests in `iterate.test.ts`, `github-iterate.test.ts`, and every other test file still pass. The refactor is purely structural — no behavior changes — so all existing tests should pass without modification.

Run `bunx tsc --noEmit` to verify type safety.

---

### Step 9: Update `CLAUDE.md` project structure section

Update the `## Project Structure` section in `CLAUDE.md` to include the new `proposal.ts` module:

```
src/
  proposal.ts          # Shared assess→name→triage→plan pipeline
```

Add it alongside the existing entries, in alphabetical order within the `src/` section.

---

### What this plan does NOT change

- **Charter check logic:** Stays separate in each mode because they have different error semantics (local returns a result; GitHub throws). This is intentional divergence, not duplication.
- **Execute+verify logic:** Already correctly shared via `runExecuteWithVerify()`.
- **Stage functions (`runAssessStage`, etc.):** Stay in `iterate.ts` — they're the building blocks; the new `buildProposal()` orchestrates them.
- **No behavioral changes:** Same prompts, same progress callbacks, same audit file names, same triage logic. Tests should pass without modification.