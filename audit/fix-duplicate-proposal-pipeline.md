Now I have a comprehensive understanding of the entire codebase. Let me formulate my assessment.

```json
{ "severity": 3, "principle": "No Knowledge Duplication", "category": "architecture" }
```

## Assessment

### What I Examined

I read every source file, test file, type definition, and configuration file in the project. The codebase is well-structured overall — clean separation of concerns, excellent use of dependency injection for testability, comprehensive test coverage, strict TypeScript configuration, and a clear architectural vision documented in CHARTER.md. This is genuinely good work.

### Most Violated Principle: No Knowledge Duplication

The codebase has a structural knowledge duplication problem: **the `iterate()` and `githubIterate()` functions duplicate the assessment-name-triage pipeline logic**, and this duplication has already started to create maintenance risk.

#### Where the duplication lives

Compare `src/iterate.ts` lines 259–330 (local mode pipeline) with `src/github-iterate.ts` lines 211–260 (proposal generation). Both implement the same multi-stage pipeline:

1. **Assess** → call `runAssessStage()`, then `parseAssessment()`
2. **Name** → call `runNameStage()`
3. **Save assessment** → call `saveStageOutput()`
4. **Triage** → call `triageRunner()`, check `accepted`, skip if rejected
5. **Plan** → call `runPlanStage()`, save output

This is not "identical code representing independent decisions that might diverge" — it is the *same decision*: "how to run the assess→name→triage→plan pipeline." If the assessment prompt changes, or a new stage is inserted between triage and plan, or the save behavior changes, both locations must be updated in lockstep. That's the definition of knowledge duplication.

#### Evidence it's already causing friction

The two implementations already have subtle inconsistencies:

- **Charter handling differs:** `iterate()` returns an `IterationResult` with `success: false` on charter failure. `githubIterate()` throws an `Error`. These are different error models for the same semantic event.
  
- **Triage result tracking differs:** `iterate()` captures `triageResult` on the `IterationResult` and returns it. `githubIterate()` increments a counter (`result.skippedTriage++`) and discards the details. If you later want to report which proposals were rejected and why, only local mode has the data.

- **Options interfaces are near-identical but separate:** `IterateOptions` and `GitHubIterateOptions` share almost every field (`agent`, `folder`, `config`, `skipGates`, `skipCharter`, `skipTriage`, `onProgress`, `gateRunner`, `gateResolver`, `charterChecker`, `triageRunner`) but are defined independently, so adding a new shared option means updating two interfaces.

#### The `IterationResult` is doing double duty

`IterationResult` serves both as the internal pipeline result and as the JSON output structure. It has nullable fields (`structuredAssessment`, `triageResult`, `charterCheck`, `skippedReason`) that represent different "why the pipeline stopped" reasons, but there's no discriminated union — a consumer must check multiple nullable fields to understand the outcome. This is a milder form of knowledge duplication: the *meaning* of the result is implicitly encoded in the combination of null/non-null fields rather than being explicit in the type.

### How to Correct It

**Extract a `propose()` function** that encapsulates the assess→name→triage→plan pipeline as a single reusable unit. Both `iterate()` and `githubIterate()` would call it:

```typescript
// Conceptual shape — not prescriptive about the exact API
interface Proposal {
  name: string;
  assessment: string;
  structuredAssessment: StructuredAssessment;
  plan: string;
  triageResult: TriageResult | null;
}

type ProposeResult =
  | { outcome: "proposed"; proposal: Proposal }
  | { outcome: "triageRejected"; name: string; assessment: string; triageResult: TriageResult }
  | { outcome: "charterFailed"; charterCheck: CharterCheckResult };
```

This would:

1. **Eliminate the pipeline duplication** — one place to add stages, change prompts, or adjust save behavior.
2. **Unify error handling** — charter failure is represented in the return type, not split between "return early" and "throw."
3. **Make `IterationResult` thinner** — it only needs to care about execution and verification, not the proposal pipeline.
4. **Reduce `GitHubIterateOptions` surface** — it can accept a proposer function rather than re-declaring every pipeline dependency.

The discriminated union return type (`ProposeResult`) would make it impossible to construct an ambiguous result — no more checking five nullable fields to figure out what happened.

### What I Considered but Rejected

- **Type safety issues** — The codebase uses `Record<string, string | boolean>` for parsed flags and `as HoneMode` in one spot, but these are contained to the CLI boundary layer and aren't causing real problems.
- **Missing error types** — Plain `Error` is used throughout rather than domain-specific errors, but the error paths are simple and well-handled. This would be YAGNI at this stage.
- **Runtime validation at boundaries** — The `loadConfig()` function uses `??` chaining without Zod validation, but the config shape is simple and the fail-open behavior is intentional. Not worth the dependency.
- **The `readFileCapped` / `readFileContent` similarity** — These exist in `derive.ts` and `charter.ts` respectively and look similar, but they actually have different semantics (one caps file size, the other doesn't), so this is independent code that happens to look alike.

### Summary

The assess→name→triage→plan pipeline is duplicated across local and GitHub modes, and the two copies have already diverged in error handling and data tracking. Extracting a shared `propose()` function with a discriminated union return type would eliminate this duplication, make the pipeline easier to extend, and bring type safety to the "why did it stop" question.