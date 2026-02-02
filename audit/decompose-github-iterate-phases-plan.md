Now I have a thorough understanding of the code. Here is the complete plan:

---

## Plan: Decompose `githubIterate()` into Three Phase Functions

### Goal

Extract the three phases of `githubIterate()` — housekeeping, execution, and proposal — into named functions so the orchestrator reads like an outline and each phase can be tested in isolation.

### Constraints

- Pure refactoring: no behavior changes, no new features
- All existing tests must continue to pass without modification
- The extracted functions stay in the same file (`src/github-iterate.ts`) — they are tightly coupled to GitHub mode and not reused elsewhere
- Exported for testability, but the primary consumer remains `githubIterate()`

---

### Step 1: Extract `closeRejectedIssues()`

Extract lines 109–124 of `github-iterate.ts` (the housekeeping loop) into a standalone async function.

**Signature:**
```typescript
export async function closeRejectedIssues(
  issues: HoneIssue[],
  owner: string,
  folder: string,
  run: CommandRunner,
  onProgress: (stage: string, message: string) => void,
): Promise<number[]>
```

**Behavior:**
- Iterates over all issues
- For each issue, fetches reactions via `getIssueReactions`
- If the owner has thumbs-downed, closes the issue and adds its number to the returned array
- Otherwise, stores the reactions on the issue object for downstream use (mutates issue.reactions — same as current behavior)
- Returns the array of closed issue numbers

**Why the owner and folder are separate params:** The caller already has them from the setup block. Passing them explicitly avoids the function needing to call `getRepoOwner()` itself, keeping it focused on one job.

---

### Step 2: Extract `executeApprovedIssues()`

Extract lines 127–209 (the approved-backlog loop plus its setup filter) into a standalone async function.

**Signature:**
```typescript
export async function executeApprovedIssues(
  issues: HoneIssue[],
  owner: string,
  closedIssueNumbers: number[],
  folder: string,
  config: HoneConfig,
  claude: ClaudeInvoker,
  opts: {
    skipGates: boolean;
    gateRunner: GateRunner;
    gateResolver: GateResolverFn;
    ghRunner: CommandRunner;
    onProgress: (stage: string, message: string) => void;
  },
): Promise<ExecutionOutcome[]>
```

**Behavior:**
- Filters issues to those where the owner has thumbs-upped AND the issue is not in `closedIssueNumbers`
- Sorts by `createdAt` ascending (oldest first)
- For each approved issue:
  - Parses the proposal from the issue body
  - Calls `runExecuteWithVerify` with the parsed assessment and plan
  - On success: commits via `gitCommit`, closes the issue with a success comment
  - On failure: closes the issue with gate failure output
  - On exception: captures the error message
  - Pushes the `ExecutionOutcome` to the results array
- Returns the array of `ExecutionOutcome` objects

---

### Step 3: Extract `proposeImprovements()`

Extract lines 211–261 (the proposal loop) into a standalone async function.

**Signature:**
```typescript
export async function proposeImprovements(
  agent: string,
  folder: string,
  config: HoneConfig,
  claude: ClaudeInvoker,
  opts: {
    proposals: number;
    skipTriage: boolean;
    ghRunner: CommandRunner;
    triageRunner: TriageRunnerFn;
    onProgress: (stage: string, message: string) => void;
  },
): Promise<{ proposed: number[]; skippedTriage: number }>
```

**Behavior:**
- Creates the audit directory
- Loops `proposals` times:
  - Runs assessment, parsing, and naming stages
  - Saves the assessment audit output
  - If triage is enabled, runs triage; on rejection, increments `skippedTriage` and continues
  - Runs the plan stage, saves the plan audit output
  - Formats the issue body and creates the GitHub issue
  - Pushes the created issue number to `proposed`
- Returns `{ proposed, skippedTriage }`

---

### Step 4: Rewrite `githubIterate()` as a Thin Orchestrator

Replace the body of `githubIterate()` with calls to the three extracted functions. The function should read roughly like:

```typescript
export async function githubIterate(
  opts: GitHubIterateOptions,
  claude: ClaudeInvoker,
): Promise<GitHubIterateResult> {
  // Destructure options (same as current)
  // Charter check (same as current, lines 88-99)
  // Ensure hone label exists
  // Fetch owner + issues

  const closed = await closeRejectedIssues(issues, owner, folder, ghRunner, onProgress);

  const executed = await executeApprovedIssues(
    issues, owner, closed, folder, config, claude,
    { skipGates, gateRunner, gateResolver, ghRunner, onProgress },
  );

  const { proposed, skippedTriage } = await proposeImprovements(
    agent, folder, config, claude,
    { proposals, skipTriage, ghRunner, triageRunner, onProgress },
  );

  return {
    mode: "github",
    housekeeping: { closed },
    executed,
    proposed,
    skippedTriage,
  };
}
```

The charter check, label creation, owner/issue fetching stay inline in `githubIterate()` because they are one-time setup, not looping phases.

---

### Step 5: Add Focused Unit Tests for Extracted Functions

Add new test cases in `github-iterate.test.ts` that test each extracted function directly. These complement the existing integration-style tests (which continue to pass unmodified).

**`closeRejectedIssues` tests:**
- Closes thumbs-downed issues and returns their numbers
- Leaves non-rejected issues alone and stores their reactions

**`executeApprovedIssues` tests:**
- Successfully executes, commits, and closes an approved issue
- Handles gate failure (closes with failure comment)
- Skips issues that can't be parsed

**`proposeImprovements` tests:**
- Creates the expected number of proposals
- Increments skippedTriage when triage rejects
- Creates zero issues when all proposals are triaged out

These tests use the existing `createMockGhRunner` and `createIterateMock` helpers. They'll be simpler than the current integration tests because each test only exercises one phase.

---

### Step 6: Verify All Quality Gates Pass

Run the full quality gate suite to confirm the refactoring is behavior-preserving:

1. `bun test` — all existing tests pass, new tests pass
2. `bunx tsc --noEmit` — zero type errors
3. `bun build src/cli.ts --compile --outfile=build/hone` — binary builds successfully

---

### What This Does NOT Change

- No new types added to `types.ts` — the existing `HoneIssue`, `ExecutionOutcome`, `GitHubIterateResult`, etc. are sufficient
- No changes to imports from `github.ts`, `iterate.ts`, or `audit.ts`
- No changes to the `GitHubIterateOptions` interface
- No changes to any other file besides `src/github-iterate.ts` and `src/github-iterate.test.ts`
- The `createMockGhRunner` helper stays as-is (the new per-phase tests can use it directly)