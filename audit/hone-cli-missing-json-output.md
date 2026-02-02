Now I have a thorough understanding of both the CONSTITUTION principles and the hone-cli architecture. Let me assess which principle is most violated.

The CONSTITUTION defines these key principles:

1. **Events Are the Source of Truth** - immutable, append-only event log
2. **Skills-as-Consumers** - query events, don't store separately
3. **CLI-First Architecture** - every tool has a CLI, code before prompts
4. **Derived Views** - generated from events, not hand-maintained
5. **Progressive Disclosure** - three-tier context loading
6. **Security Protocols** - credentials in env vars, audit trail
7. **Composability (Unix Philosophy)** - do one thing well, text streams, compose via pipes

## Assessment

The principle hone-cli most violates is **Composability (Unix Philosophy)** — specifically the sub-principles of text streams, compose via pipes, and `--json` output.

Here's the case:

**1. No `--json` output mode.** The CONSTITUTION explicitly states that every CLI tool should support `--json` for machine-readable output. Hone-cli commands write human-readable text to the console but provide no structured JSON output option. This makes it impossible to compose hone with other tools in the MojilityNG ecosystem programmatically. For example, you can't pipe `hone history` into `jq` to extract iteration data, or feed `hone gates` results into the event system.

**2. No event emission.** The CONSTITUTION requires that "all actions that modify state should produce events" and that the event log is the audit trail. Hone runs iterations, executes quality gates, and records results in its own `audit/` directory — but never emits events to `events/intake/`. This creates a parallel storage system that violates both the "Events Are the Source of Truth" and "Skills-as-Consumers" principles. Iteration results, gate pass/fail outcomes, and retry counts are valuable business data that should flow through the event log, not live in isolated markdown files.

**3. Monolithic stage orchestration instead of composable commands.** The `iterate` command runs a 5-stage pipeline internally (assess → name → plan → execute → verify) as a single indivisible operation. The Unix philosophy says to compose small tools via pipes. Each stage could be an independent command — `hone assess`, `hone plan`, `hone execute` — that reads from stdin or files and writes structured output. This would allow users to run individual stages, compose custom workflows, and integrate with other MojilityNG tools.

## How to Correct

The highest-impact corrections, in priority order:

1. **Add `--json` output to all commands.** Each command should support a `--json` flag that emits structured JSON to stdout. For `iterate`, this means a JSON object with stage results, gate outcomes, retry count, and file paths. For `gates`, a JSON array of gate results. For `history`, JSON iteration records. This is the single most impactful change — it unlocks composition with every other tool in the ecosystem.

2. **Emit events for iteration lifecycle.** When an iteration completes (or fails), hone should emit events to the MojilityNG event intake. Events like `hone.iteration.completed`, `hone.gates.passed`, `hone.gates.failed` would integrate hone's work into the single source of truth. The audit directory can remain as a detailed log, but the event system should capture the summary.

3. **Decompose iterate into composable stages.** Expose `hone assess`, `hone plan`, `hone execute`, and `hone verify` as independent subcommands. The current `hone iterate` becomes a convenience wrapper that pipes them together. Each stage reads its input (previous stage output or a file) and writes structured output. This follows the "small tools" principle and enables custom workflows.

The first correction (adding `--json`) is the most actionable and delivers the most immediate value for ecosystem integration.