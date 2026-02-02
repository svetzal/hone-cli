Now I have a complete picture. Let me compile my assessment.

```json
{ "severity": 3, "principle": "No Knowledge Duplication", "category": "architecture" }
```

## Assessment

### Summary

This is a well-built project. The code is clear, well-tested, modular, and type-safe. Strict mode is enabled, there are no `any` types, dependency injection is used throughout for testability, and the tests are comprehensive (23 test files covering almost every module). The architecture clearly separates concerns: each stage in the pipeline has its own module, external boundaries are injectable, and the functional core / imperative shell pattern is applied well.

After reviewing every source file and every test file, the principle this project most violates is **No Knowledge Duplication** — specifically, the structural duplication of how the `IterateOptions` and `GitHubIterateOptions` interfaces assemble and pass the same pipeline dependencies, and how the local mode iteration workflow in `iterate.ts` and the GitHub mode proposal loop in `github-iterate.ts` both independently implement the same assess → name → triage → plan pipeline sequence.

### The Duplication

**1. Options interfaces share the same injectable dependencies**

`IterateOptions` (iterate.ts:23-35) and `GitHubIterateOptions` (github-iterate.ts:43-57) both carry the same injectable dependency slots:

```typescript
// iterate.ts — IterateOptions
gateRunner?: GateRunner;
gateResolver?: GateResolverFn;
charterChecker?: CharterCheckerFn;
triageRunner?: TriageRunnerFn;
onProgress: (stage: string, message: string) => void;

// github-iterate.ts — GitHubIterateOptions
gateRunner?: GateRunner;
gateResolver?: GateResolverFn;
charterChecker?: CharterCheckerFn;
triageRunner?: TriageRunnerFn;
onProgress: (stage: string, message: string) => void;
ghRunner?: CommandRunner;
```

These are the same shape repeated. Both even have the same optional defaults (`skipGates`, `skipCharter`, `skipTriage`), the same `config: HoneConfig`, and the same `agent: string` / `folder: string`. They diverge only by `ghRunner` and `proposals` in the GitHub variant.

**2. The assess → name → triage → plan pipeline is duplicated**

In `iterate.ts` (lines 286-337), the local mode runs:
1. Assess → `runAssessStage()`
2. Parse assessment → `parseAssessment()`
3. Name → `runNameStage()`
4. Save assessment
5. Triage (if enabled)
6. Plan → `runPlanStage()`
7. Save plan

In `github-iterate.ts` (lines 215-261), the proposal loop runs **the exact same sequence**:
1. Assess → `runAssessStage()`
2. Parse assessment → `parseAssessment()`
3. Name → `runNameStage()`
4. Save assessment
5. Triage (if enabled)
6. Plan → `runPlanStage()`
7. Save plan

The only difference is what happens *after* the plan — local mode executes immediately, while GitHub mode creates an issue. But the pipeline up to "plan" is duplicated step-for-step, including the same triage check pattern, the same progress callbacks, and the same audit file saves.

This is **knowledge duplication**: if the pipeline changes (e.g., adding a new stage between triage and plan, changing how assessments are saved, or adjusting what gets passed to triage), both locations must change in lockstep. They represent the same decision — "how does hone go from nothing to a plan?" — encoded in two places.

### Why This Matters

It's currently manageable at two locations, but it's the kind of duplication that creates drift. If a future change adds a stage (like a "scope check" between triage and plan), forgetting to update one path would produce subtle behavioral differences between local and GitHub modes. The shared stage functions (`runAssessStage`, etc.) were correctly extracted as reusable, but the *orchestration sequence* that calls them was not.

### How to Correct It

Extract the assess → name → triage → plan pipeline into a shared function, something like:

```typescript
interface ProposalResult {
  name: string;
  assessment: string;
  plan: string;
  structuredAssessment: StructuredAssessment;
  triageResult: TriageResult | null;
  skipped: boolean;
  skippedReason: string | null;
}

async function buildProposal(
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
): Promise<ProposalResult> {
  // Assess → Name → Save → Triage → Plan → Save
  // Single source of truth for the pipeline
}
```

Then both `iterate()` and the proposal loop in `githubIterate()` call `buildProposal()` and branch only on what to do with the result (execute locally vs. create GitHub issue).

Similarly, the shared injectable dependencies could be extracted into a base interface:

```typescript
interface PipelineDependencies {
  gateRunner?: GateRunner;
  gateResolver?: GateResolverFn;
  charterChecker?: CharterCheckerFn;
  triageRunner?: TriageRunnerFn;
  onProgress: (stage: string, message: string) => void;
}

interface IterateOptions extends PipelineDependencies { /* local-specific */ }
interface GitHubIterateOptions extends PipelineDependencies { /* github-specific */ }
```

This is a moderate refactor — the shared stage functions are already extracted, so the remaining work is extracting the *orchestration* that calls them in sequence. No behavior changes, just consolidating the pipeline coordination into one place.

### Other Observations (not rising to the level of the primary violation)

- **`configCommand` omits fields**: The human-readable output for `hone config` displays only 4 of 7 model names (misses `gates`, `derive`, `triage`) and omits `mode`, `minCharterLength`, and `severityThreshold`. The JSON output includes everything via `writeJson(config)`, so the structured output is correct, but the human-readable display doesn't match the full config shape. This is a minor knowledge duplication issue — the display format doesn't stay in sync with the config type.

- **`loadConfig` accepts unvalidated user input**: `file.json()` returns `any` and the merge uses `userConfig.models` without any type checking. A malformed config (e.g., `"maxRetries": "banana"`) would propagate without error. Runtime validation at this boundary (via Zod or manual checks) would match the pattern used elsewhere in the codebase for LLM output parsing.

- **No test for `json-extraction.ts`**: This is the single source of truth for extracting JSON from LLM output, used by both `parse-assessment.ts` and `triage.ts`. It has no dedicated test file, even though its regex-based extraction has edge cases worth verifying (nested braces, multiple JSON blocks, malformed JSON).