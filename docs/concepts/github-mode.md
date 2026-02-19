# GitHub Mode

In local mode, hone executes improvements immediately. GitHub mode adds an approval layer: proposals become GitHub issues that the repo owner reviews before any code changes happen. This makes hone safe for team workflows where you want a human curating which improvements to apply.

## Three-phase workflow

Each `hone iterate --mode github` invocation runs three phases in sequence:

### Phase 1: Housekeeping

Hone checks all open issues with the `hone` label. If the repo owner has added a thumbs-down reaction to any of them, hone closes those issues with a note. This clears rejected proposals from the backlog.

### Phase 2: Execute approved backlog

Hone looks for open `hone` issues where the repo owner has added a thumbs-up reaction. These are processed oldest-first:

1. Parse the assessment and plan from the issue body
2. Run the execute + verify loop (same as local mode)
3. On success: commit the changes, close the issue with the commit hash
4. On failure: close the issue with the gate failure output

Commits use the format: `[Hone] <issue title> (#<issue number>)`

### Phase 3: Propose improvements

Hone runs the assessment pipeline (assess, name, triage, plan) and creates new GitHub issues for proposals that pass triage. Each issue includes:

- The agent name and severity rating
- The full assessment prose
- The step-by-step plan
- The `hone` label for tracking

## Approval via reactions

The repo owner controls the workflow with GitHub reactions on hone issues:

| Reaction | Effect |
|----------|--------|
| :+1: (thumbs up) | Approve — hone will execute this proposal on its next run |
| :-1: (thumbs down) | Reject — hone will close this issue on its next run |
| (no reaction) | Pending — stays in the backlog |

Only the repo owner's reactions are checked. Other team members can discuss in comments, but approval authority is limited to the owner.

## Controlling proposal volume

By default, hone creates one proposal per invocation. Use `--proposals` to generate more:

```bash
hone iterate typescript-craftsperson . --mode github --proposals 3
```

Each proposal gets its own triage pass. Requesting 5 proposals may yield 3 if two don't clear triage — the count is a ceiling, not a guarantee.

## Issue format

Issues are created with a structured body:

```markdown
**Agent:** typescript-craftsperson
**Severity:** 4/5
**Principle:** Error handling consistency

## Assessment

[Full assessment prose from the agent...]

## Plan

[Step-by-step correction plan...]
```

A hidden HTML comment at the top contains machine-readable metadata (agent name, severity, principle, filename) that hone uses when parsing the issue for execution.

## Hone doesn't poll

Hone is stateless — it doesn't run in the background waiting for reactions. You re-invoke it to process approvals. Common setups:

### Manual

```bash
# Morning: check for approvals and propose new improvements
hone iterate typescript-craftsperson . --mode github --proposals 3
```

### Cron

```bash
# Run every weekday at 9am
0 9 * * 1-5 cd /path/to/project && hone iterate typescript-craftsperson . --mode github --proposals 2
```

### CI (GitHub Actions)

```yaml
name: Hone Iteration
on:
  schedule:
    - cron: '0 14 * * 1-5'  # Weekdays at 2pm UTC
  workflow_dispatch:         # Manual trigger

jobs:
  iterate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run hone
        run: hone iterate typescript-craftsperson . --mode github --proposals 2
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Failed executions

When a proposal is approved but execution fails (gates don't pass after max retries), hone closes the issue with a comment containing the gate failure output. The proposal doesn't block future iterations — hone may reassess and propose a different approach in a later run.

## Compared to local mode

| Aspect | Local | GitHub |
|--------|-------|--------|
| Approval | Automatic (triage only) | Human (thumbs-up reaction) |
| Execution | Immediate | Next invocation after approval |
| Proposals per run | 1 | Configurable (`--proposals`) |
| Requires `gh` CLI | No | Yes |
| Best for | Solo work, rapid iteration | Teams, code review workflows |
