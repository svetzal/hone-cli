# First Iteration

This walkthrough takes you from zero to your first improvement cycle. You'll generate an agent, review what hone discovered about your project, and run a full iteration.

## Step 1: Generate an agent

Point `hone derive` at your project root:

```bash
hone derive /path/to/your/project
```

Derive uses Claude to explore your project — reading source files, build configs, CI pipelines, and tooling setup — then generates two things:

1. **An agent** — a markdown file with engineering principles, coding guidelines, and QA checkpoints tailored to your stack. Written to `~/.claude/agents/` by default (use `--local` to write to `<project>/.claude/agents/` instead).

2. **A gates file** — `.hone-gates.json` in your project root, listing the quality gate commands hone will use to verify changes.

## Step 2: Review what was generated

Check which agents are available:

```bash
hone list-agents
```

Look at the gates that were detected for your project:

```bash
hone gates /path/to/your/project
```

You'll see output like:

```
Quality gates for /path/to/your/project:

  test        bun test                  required
  typecheck   bunx tsc --noEmit         required
  lint        bunx biome check src      required
  security    npm audit                 optional
```

Gates marked `required` trigger the retry loop when they fail. Optional gates are reported but don't block.

Open the generated agent file to see the principles hone will assess against. The agent name is derived from your project's primary technology (e.g. `typescript-craftsperson`, `python-craftsperson`).

## Step 3: Run your first iteration

```bash
hone iterate <agent-name> /path/to/your/project
```

Hone runs the full [iteration pipeline](/concepts/iteration-pipeline). You'll see progress output as each stage completes:

```
Charter check passed (README.md: 1,247 chars)
Preflight: 3 gates passed
Assessing project against agent principles...
Assessment: severity 4/5 — Missing error boundaries in async handlers
Triage: accepted (severity 4, change type: bugfix)
Planning correction...
Executing plan...
Running gates (attempt 1/4)...
  test        ✓
  typecheck   ✓
  lint        ✓
All required gates passed.
```

If a required gate fails, hone sends the agent back with the failure output. This repeats up to `--max-retries` times (default: 3).

## Step 4: Check the audit trail

After a run, look in the `audit/` directory (or wherever `--audit-dir` points):

```
audit/
  fix-missing-error-boundaries.md              # Assessment
  fix-missing-error-boundaries-plan.md         # Step-by-step plan
  fix-missing-error-boundaries-actions.md      # What the agent did
```

If retries were needed, you'll also see files like `fix-missing-error-boundaries-retry-1-actions.md`.

Use `hone history` to see past iterations:

```bash
hone history /path/to/your/project
```

## When triage rejects a proposal

Not every assessment leads to code changes. If the identified violation is low-severity or classified as busy-work, triage rejects it:

```
Assessment: severity 2/5 — Import ordering inconsistency
Triage: rejected (busy-work: organization)
Nothing substantive to improve.
```

This is a **success state** — it means your codebase is in good shape relative to the agent's principles. Hone exits cleanly with `success: true`.

## Next steps

- Learn about the full [iteration pipeline](/concepts/iteration-pipeline) and what each stage does
- Understand [agents and principles](/concepts/agents) to customize what hone looks for
- Configure [quality gates](/concepts/quality-gates) to match your project's tooling
- Set up [GitHub mode](/concepts/github-mode) for team workflows with approval gates
