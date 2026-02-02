```json
{ "severity": 3, "principle": "Reveals Intent / Minimal Entities", "category": "Function Decomposition" }
```

## Assessment: Most Violated Principle

### What I Found

This codebase is well-engineered — zero `any` types, strict TypeScript config, excellent test coverage (1.41:1 test-to-source ratio), clean functional core / imperative shell architecture, and comprehensive dependency injection. Credit where it's due: this is a well-maintained project.

However, the principle most violated is **"Reveals Intent"** through the lens of function decomposition, specifically in the **`githubIterate()` function** at `src/github-iterate.ts`.

### The Violation: `githubIterate()` at ~205 Lines

This single function contains three clearly distinct phases that are currently inlined as one monolithic orchestrator:

1. **Housekeeping** (~20 lines) — Closes issues the repo owner has thumbs-downed
2. **Execute Approved Backlog** (~83 lines) — Processes thumbs-up issues: execute, verify, commit, close
3. **Propose New Improvements** (~50 lines) — Assess, triage, plan, create new GitHub issues

Each phase has its own loop, its own error handling, and its own result accumulation. They share the `onProgress` callback and `config`, but nothing else flows between them that couldn't be passed as arguments.

**Why this matters:**

- A reader opening `githubIterate()` must mentally parse 205 lines before understanding the three-phase structure. The phases are separated by comments, but the function signature reveals none of this intent.
- Each phase is independently testable, but currently the test file (`github-iterate.test.ts`) must wire up the entire function to test any one phase — making tests slower, more fragile, and harder to understand.
- The function accumulates results across all three phases into separate arrays (`closedIssues`, `executedResults`, `proposedIssues`, `skippedTriage`), which is a classic signal that the function is doing multiple things.

### How to Correct It

Extract each phase into a named function:

```typescript
// Phase 1: Close rejected issues
async function closeRejectedIssues(
  issues: GitHubIssue[],
  run: CommandRunner,
  onProgress?: ProgressCallback,
): Promise<number[]> { ... }

// Phase 2: Execute approved issues
async function executeApprovedIssues(
  issues: GitHubIssue[],
  config: ResolvedConfig,
  invoke: ClaudeInvoker,
  run: CommandRunner,
  options: ExecuteOptions,
  onProgress?: ProgressCallback,
): Promise<ExecutedResult[]> { ... }

// Phase 3: Propose new improvements
async function proposeImprovements(
  config: ResolvedConfig,
  invoke: ClaudeInvoker,
  run: CommandRunner,
  options: ProposeOptions,
  onProgress?: ProgressCallback,
): Promise<{ proposed: number[]; skipped: number }> { ... }
```

Then `githubIterate()` becomes a ~30-line orchestrator that:
1. Fetches open issues
2. Partitions them by reaction
3. Calls each phase function
4. Assembles the `GitHubIterateResult`

**Benefits:**
- Each phase can be tested in isolation with simpler mocks
- The orchestrator reads like an outline of the GitHub mode workflow
- Phase-specific error handling is localized rather than interleaved
- Future changes to one phase (e.g., parallel proposal generation) don't risk breaking the others

### Secondary Findings (Lower Severity)

| Severity | Finding | Location |
|----------|---------|----------|
| 2 | Unvalidated `as HoneMode` cast — `--mode foobar` silently accepted | `commands/iterate.ts:26` |
| 2 | `loadConfig()` doesn't validate user JSON shape | `config.ts:33` |
| 2 | `json-extraction.ts` lacks dedicated test file (covered indirectly) | `src/json-extraction.ts` |
| 1 | Test config duplicates defaults instead of using `getDefaultConfig()` | `commands/iterate.test.ts:6-23` |

The primary recommendation is to decompose `githubIterate()` — it's the clearest case where the code's structure doesn't reveal its intent, and the fix is straightforward extraction without changing behavior.