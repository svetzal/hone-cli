Now I have the full picture. Let me compose my assessment.

```json
{ "severity": 4, "principle": "Events Are the Source of Truth", "category": "Core Philosophy" }
```

## Assessment

Hone-cli's most significant violation is **Constitution Principle #1: Events Are the Source of Truth**. The project records all of its operational history — assessments, plans, executions, retries, gate results — as loose markdown files in a per-project `audit/` directory, completely disconnected from the MojilityNG event system.

### What's happening today

Every hone iteration produces 2-4 markdown files in `<project>/audit/`:
- `<name>.md` (assessment)
- `<name>-plan.md` (plan)
- `<name>-actions.md` (execution)
- `<name>-retry-N-actions.md` (retries)

These files are the *only* record of what hone did. There are no events emitted to `events/intake/`. The `audit.ts` module manages this markdown-file-based storage directly. The `listIterations()` function scrapes the audit directory to reconstruct history from filenames and mtimes.

### Why this is a significant violation (severity 4)

The Constitution states: *"Events are facts — immutable, append-only record of what happened"* and *"All actions that modify state should produce events. The event log is the audit trail."*

Hone *modifies project codebases*. It runs LLM agents that write code, create commits, and open GitHub issues. Yet none of this produces events. This means:

1. **No cross-project visibility** — You can't query "what did hone change across all projects this month?" without scraping each project's audit directory.
2. **No composability with other skills** — The ClientInsights, Retrospective, and Billing skills can't see hone activity because it isn't in the event stream.
3. **Fragile history** — Audit files live inside target projects. If a project is deleted, archived, or moved, the hone history goes with it. Events in `events/intake/` would survive.
4. **No derived views** — You can't generate a "hone activity report" from events. The `history` command reimplements event querying by parsing filenames.

### How to correct it

**Emit events at key lifecycle points.** The iteration pipeline has natural event boundaries:

| Event | When | Key Data |
|-------|------|----------|
| `hone.iteration.started` | After preamble passes | project, agent, gates found |
| `hone.assessment.completed` | After assess stage | severity, principle, category |
| `hone.triage.completed` | After triage | accepted, changeType, busyWork |
| `hone.execution.completed` | After execute+verify | success, retries, gates pass/fail |
| `hone.proposal.created` | GitHub mode: issue filed | issue number, title |
| `hone.proposal.executed` | GitHub mode: approved & applied | issue number, commit SHA |

**Concrete steps:**

1. **Add an event emitter** — a function that appends JSONL to `events/intake/YYYY-MM.jsonl` (or calls `evt log` from the MojilityNG context). The audit markdown files can remain as detailed artifacts, but the structured facts should flow into the event stream.
2. **Wire it into `iterate()` and `githubIterate()`** — emit at each stage boundary. The `onProgress` callback pattern already exists; an event emitter could be composed alongside it.
3. **Keep audit files as supplementary detail** — Events capture the structured facts (what happened, severity, outcome). Audit markdown files hold the unstructured detail (full assessment prose, execution logs). Events *reference* audit files by name rather than duplicating their content.

The audit directory isn't wrong — it's the detailed artifact store. What's missing is the structured, queryable, composable event stream that makes hone's activity visible to the rest of the operating system.