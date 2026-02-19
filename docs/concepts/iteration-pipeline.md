# The Iteration Pipeline

Every `hone iterate` invocation runs a pipeline that finds what your code does worst, fixes it, and independently verifies the fix. The pipeline has two nested loops: an **outer improvement cycle** that moves through assessment, planning, and execution stages, and an **inner enforcement loop** that re-runs quality gates until they pass or retries are exhausted.

```
Charter Check → Preflight → Assess → Name → Triage → Plan → Execute ⇄ Verify → Summarize
                                                                 ↑              |
                                                                 └── retry ─────┘
```

## Design philosophy

Three ideas shape how the pipeline works.

### The agent never self-certifies

An LLM will confidently tell you it followed all your rules, passed all your checks, or explain why some of them don't matter. Hone doesn't ask the agent whether it succeeded — it runs your quality gates as subprocesses and checks exit codes. The agent proposes and executes; hone verifies independently.

### Non-determinism is directed, not eliminated

Each iteration explores different improvement opportunities that a human might not consider. This is the value proposition — the LLM's creativity surfaces real problems. But that same eagerness means the agent always finds *something* to suggest, even when the codebase is in good shape. The pipeline constrains this with triage.

### Busy-work containment

Left unchecked, an LLM will produce cosmetic refactors, docstring campaigns, import reorganization, and incidental polish that takes the project in unintended directions. The triage stage exists specifically to filter these out. When triage rejects a proposal, hone exits cleanly — this is a success state meaning the codebase is in good shape relative to the agent's principles.

## Stages

### Charter Check

**What it does:** Verifies the project has intent documentation before any LLM work begins.

**Why it exists:** Hone cannot distinguish substantive improvements from busy-work without understanding project goals. Without clear intent, the agent produces unfocused improvements. This is a hard stop, not a warning.

**How it works:** Checks for content meeting a minimum length threshold (default: 100 characters) in these sources, in order:

1. `CHARTER.md`
2. `CLAUDE.md` with a `## Project Charter` section
3. `README.md`
4. Package manager description (`package.json`, `mix.exs`, `pyproject.toml`)

If nothing qualifies, the pipeline stops with guidance on what to add. No model is involved — this is a heuristic check.

**Skip with:** `--skip-charter`

### Preflight

**What it does:** Resolves quality gates and runs them against the unmodified codebase.

**Why it exists:** If required gates fail *before* any changes are made, the gates themselves are broken — missing tools, wrong paths, pre-existing test failures. There's no point sending an agent to fix environment problems it can't fix. Preflight catches this early before any LLM calls are made.

**How it works:** Gates are resolved in priority order:

1. `.hone-gates.json` in the project root (no LLM call needed)
2. Agent extraction via Claude from the agent's QA checkpoints
3. No gates found — verification will be skipped

Once resolved, every gate runs as a subprocess. If any required gate fails, the pipeline stops with the failure output.

**Skip with:** `--skip-gates`

### Assess

**What it does:** Evaluates the project against the agent's engineering principles and identifies the most violated one.

**Why it exists:** This is the core judgment call — the agent reads the codebase with the lens of its defined principles and picks the highest-priority issue. The output drives everything downstream.

**Model:** Opus (read-only tools). Opus is used here because assessment requires the deepest reasoning — the agent must understand the codebase holistically, weigh multiple principles against each other, and produce a nuanced judgment about what matters most.

**Output:** A structured JSON block with severity (1-5), principle name, and category, followed by full prose assessment. The JSON is parsed for triage; the prose is passed to planning.

**Audit artifact:** `<name>.md`

### Name

**What it does:** Generates a short kebab-case filename summarizing the issue (e.g., `fix-duplicate-api-helpers`).

**Why it exists:** Every stage saves audit artifacts. The name provides a human-readable identifier that ties the assessment, plan, and execution logs together.

**Model:** Haiku (read-only, no tools). This is a trivial text transformation — the cheapest, fastest model handles it fine.

**Output:** A sanitized string, max 50 characters, used as the base filename for all audit files in this iteration.

### Triage

**What it does:** Filters the assessment through two layers before any planning or execution happens.

**Why it exists:** The busy-work problem. An LLM will always find something to suggest. Triage is the containment mechanism that prevents cosmetic churn from consuming iteration cycles.

**Layer 1 — Severity threshold (no LLM):** The structured severity from the assessment is compared against the threshold (default: 3). Anything below is rejected immediately with no further LLM calls.

**Layer 2 — Busy-work detection (Haiku):** A separate, skeptical LLM pass classifies the proposed change and rejects known busy-work categories:

- Adding comments or docstrings to unchanged logic
- Reorganizing imports or file structure without behavioral change
- Adding abstractions for single-use code
- Adding error handling for internal or impossible cases
- Type annotation campaigns on stable code
- "Consistency" refactors that don't fix bugs or enable features
- Cosmetic renaming without functional benefit

When triage rejects a proposal, hone exits with `success: true`. The codebase is in good shape.

**Skip with:** `--skip-triage`

### Plan

**What it does:** Creates a step-by-step correction plan from the assessment.

**Why it exists:** Separating planning from execution produces better results. The planning model sees the full assessment and creates a detailed action plan without the pressure of also modifying files. This plan becomes the execution model's instructions.

**Model:** Opus (read-only tools). Planning benefits from the same deep reasoning as assessment — the model needs to understand the codebase structure, anticipate side effects, and produce a plan that a different model can follow unambiguously.

**Output:** Full prose plan with actionable steps. The complete text is passed to the execution stage.

**Audit artifact:** `<name>-plan.md`

### Execute

**What it does:** Applies the plan — makes actual code changes to the project.

**Why it exists:** This is where the improvement happens. The execution model receives the assessment (the "why") and the plan (the "what") and modifies files accordingly.

**Model:** Sonnet (full tool access). Sonnet balances capability with speed for code modification tasks. It gets full tool access — Read, Write, Edit, Glob, Grep, Bash — because it needs to modify files, run commands, and verify its own work locally.

**Output:** A log of what was done, saved as an audit artifact.

**Audit artifact:** `<name>-actions.md`

### Verify (inner loop)

**What it does:** Runs quality gates after execution, retrying on failure.

**Why it exists:** The agent never self-certifies. Hone independently verifies every gate by running project-specific commands as subprocesses and checking exit codes.

**How the retry loop works:**

```
Execute
  ↓
Run all quality gates
  ↓
All required gates pass? → Done
  ↓
Any required gate failed? → Build retry prompt → Execute again
  ↓
Max retries exceeded? → Stop, report failures
```

Each retry prompt includes:

1. **The original plan** — what was being fixed
2. **The original assessment** — why it was being fixed
3. **Cumulative attempt history** — every prior attempt's failed gates and output, so the agent can see the full trajectory of what it tried
4. **Current failures** — which gates failed and their captured output (last 200 lines)
5. **Instruction** — fix the failures without regressing on the original improvement

The cumulative history prevents the agent from ping-ponging between the same failures across retries. Each retry is saved separately as `<name>-retry-N-actions.md`.

Gates are re-read from `.hone-gates.json` before each retry, so if the agent updated the gate definitions as part of its fix, the new definitions are used.

**Default max retries:** 3 (configurable with `--max-retries`)

### Summarize

**What it does:** Generates a headline and summary suitable for git commit messages.

**Why it exists:** After a successful iteration, the output needs to be captured in a commit. The summarize stage produces an imperative headline (max 72 characters) and a 2-5 line body from the structured context of what was assessed, planned, and executed.

**Model:** Haiku (read-only, no tools). Summarization is a straightforward text generation task from structured input.

**When it runs:** Only on success. If gates are still failing after all retries, there's nothing to summarize.

**Failure behavior:** Summarize is cosmetic — if it fails, the pipeline still reports success. The headline and summary fields will be null, but the code improvement was applied and verified.

## GitHub mode variations

In GitHub mode, the same stages wrap into an issue-based approval workflow. Each invocation runs three phases:

### Phase 1: Housekeeping

Closes any open hone issues that the repo owner has reacted to with a thumbs-down. No code changes, no LLM calls.

### Phase 2: Execute approved backlog

Processes thumbs-up issues oldest-first. For each approved issue:

1. Parse the assessment and plan from the issue body
2. Run **Execute** and **Verify** (with the same retry loop as local mode)
3. On success: commit the changes and close the issue
4. On failure: close the issue with gate output in a comment

### Phase 3: Propose

Runs the full **Assess → Name → Triage → Plan** sequence, but instead of executing, creates a GitHub issue with the assessment, plan, and metadata. The `--proposals N` flag controls how many proposals per invocation — each gets its own triage pass, so requesting 5 may yield 3 if two are filtered.

The key difference from local mode: proposals are cheap (creating an issue costs nothing), but execution requires explicit human sign-off via a thumbs-up reaction. Hone doesn't poll — re-invoke it via cron or CI to process approvals.

## Audit trail

Every stage that produces output saves it to the audit directory (default: `audit/` relative to the project root, configurable with `--audit-dir`). A single iteration produces:

```
audit/
  fix-missing-error-handling.md                # Assessment
  fix-missing-error-handling-plan.md           # Plan
  fix-missing-error-handling-actions.md        # Execution log
  fix-missing-error-handling-retry-1-actions.md  # First retry (if needed)
  fix-missing-error-handling-retry-2-actions.md  # Second retry (if needed)
```

The filenames are derived from the Name stage output, providing a human-readable link between the issue and its artifacts. Use `hone history` to browse past iterations.

## Model selection rationale

| Stage | Model | Why |
|-------|-------|-----|
| Assess | Opus | Deepest reasoning needed — holistic codebase understanding, principle weighing |
| Name | Haiku | Trivial text transformation — speed and cost matter, reasoning doesn't |
| Triage | Haiku | Classification task with clear categories — fast skeptical pass |
| Plan | Opus | Strategic planning benefits from the same deep reasoning as assessment |
| Execute | Sonnet | Best balance of capability and speed for code modification |
| Summarize | Haiku | Structured-input-to-text generation — straightforward task |

All models are configurable via `~/.config/hone/config.json` or CLI flags (`--assess-model`, `--plan-model`, `--execute-model`, `--summarize-model`).
