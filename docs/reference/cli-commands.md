# CLI Commands

All commands support `--json` for machine-readable output (progress goes to stderr, structured data to stdout) and `--help` for usage information.

## iterate

Run one improvement cycle: assess, plan, execute, verify.

```bash
hone iterate <agent> <folder>
```

**Examples:**

```bash
hone iterate python-craftsperson .
hone iterate typescript-craftsperson ./src --max-retries 5
hone iterate elixir-phoenix-craftsperson ./apps/web --skip-gates
hone iterate cpp-qt-craftsperson . --mode github --proposals 3
```

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--mode <local\|github>` | `local` | Operational mode ([local](/concepts/iteration-pipeline) or [GitHub](/concepts/github-mode)) |
| `--proposals <n>` | `1` | Proposals to generate (GitHub mode only) |
| `--max-retries <n>` | `3` | Retry attempts after gate failures |
| `--skip-gates` | off | Skip quality gate verification |
| `--skip-charter` | off | Skip charter clarity check |
| `--skip-triage` | off | Skip triage (severity + busy-work filter) |
| `--severity-threshold <n>` | `3` | Minimum severity to proceed (1-5) |
| `--min-charter-length <n>` | `100` | Minimum charter content length in characters |
| `--assess-model <model>` | `opus` | Override the assessment model |
| `--plan-model <model>` | `opus` | Override the planning model |
| `--execute-model <model>` | `sonnet` | Override the execution model |
| `--summarize-model <model>` | `haiku` | Override the summarize model |
| `--audit-dir <path>` | `audit` | Audit log directory (relative or absolute) |

**Audit output:**

Each run creates files in the audit directory:

```
audit/
  fix-missing-error-handling.md                # Assessment
  fix-missing-error-handling-plan.md           # Plan
  fix-missing-error-handling-actions.md        # Execution log
  fix-missing-error-handling-retry-1-actions.md  # Retry (if gates failed)
```

**JSON output** includes `structuredAssessment`, `triageResult`, `charterCheck`, `skippedReason`, `headline`, and `summary` fields. The `headline` and `summary` are populated on success for use as commit messages.

---

## maintain

Update project dependencies and verify quality gates pass.

```bash
hone maintain <agent> <folder>
```

**Examples:**

```bash
hone maintain typescript-craftsperson .
hone maintain python-craftsperson ./backend --max-retries 5
```

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--max-retries <n>` | `3` | Retry attempts after gate failures |
| `--execute-model <model>` | `sonnet` | Override the execution model |
| `--summarize-model <model>` | `haiku` | Override the summarize model |
| `--audit-dir <path>` | `audit` | Audit log directory |

Maintain requires gates — if none are found, it exits with an error. The agent receives guidelines to prefer minor/patch updates over major versions and to update one ecosystem at a time.

---

## derive

Generate an agent and `.hone-gates.json` for a project.

```bash
hone derive <folder>
```

**Examples:**

```bash
hone derive .               # Agent goes to ~/.claude/agents/
hone derive . --local       # Agent goes to <folder>/.claude/agents/
```

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--global` | on | Write agent to `~/.claude/agents/` |
| `--local` | off | Write agent to `<folder>/.claude/agents/` |

Derive explores your project's source code, build configuration, CI pipelines, and tooling configuration using Claude's read-only tools. The generated agent name follows the convention `<technology>-craftsperson`.

See [Agents & Principles](/concepts/agents) for details on what gets generated.

---

## derive-gates

Generate a `.hone-gates.json` file without creating an agent.

```bash
hone derive-gates [agent] <folder>
```

**Examples:**

```bash
hone derive-gates .                              # Inspect project tooling only
hone derive-gates typescript-craftsperson .       # Use agent as additional context
hone derive-gates . --run                         # Generate and run immediately
```

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--run` | off | Run gates after generating |
| `--derive-model <model>` | `opus` | Override model for project inspection |

If an agent name is provided, its content is included as context, but gate commands are still derived from the project's actual tooling files.

---

## mix

Augment a local agent with ideas from a global agent.

```bash
hone mix <foreign-agent> <folder>
```

**Examples:**

```bash
hone mix typescript-craftsperson . --principles
hone mix typescript-craftsperson . --gates
hone mix typescript-craftsperson . --principles --gates
```

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--from <name>` | — | Foreign agent name (from `~/.claude/agents/`) |
| `--principles` | off | Mix engineering principles |
| `--gates` | off | Mix QA checkpoints |

At least one of `--principles` or `--gates` is required.

The **local agent** (in `<folder>/.claude/agents/`) is the target that gets modified. The **foreign agent** (in `~/.claude/agents/`) provides ideas to incorporate. Existing local principles take priority over conflicting foreign ones.

See [Agents & Principles — Mixing agents](/concepts/agents#mixing-agents) for details.

---

## gates

Show, run, or save quality gates.

```bash
hone gates [agent] [folder]
```

**Examples:**

```bash
hone gates .                                     # Show gates from .hone-gates.json
hone gates typescript-craftsperson .             # Show gates (with agent as context)
hone gates . --run                               # Run gates and report pass/fail
hone gates typescript-craftsperson . --save      # Extract from agent, write .hone-gates.json
hone gates typescript-craftsperson . --save --run  # Extract, save, then run
```

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--run` | off | Run the gates and report pass/fail |
| `--save` | off | Write resolved gates to `.hone-gates.json` |

See [Quality Gates](/concepts/quality-gates) for details on gate resolution and the file format.

---

## list-agents

List agents discovered in `~/.claude/agents/`.

```bash
hone list-agents
```

No flags. Recognizes both `.md` and legacy `.agent.md` file extensions.

---

## history

Show past iterations from the audit directory, most recent first.

```bash
hone history [folder]
```

**Examples:**

```bash
hone history .
hone history ./src --audit-dir custom-audit
```

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--audit-dir <path>` | `audit` | Audit log directory |

Groups related audit files (assessment, plan, actions, retries) by their base name and displays them with modification timestamps.

---

## config

Print the active configuration (defaults merged with `~/.config/hone/config.json`).

```bash
hone config
```

No flags. See [Configuration](/reference/configuration) for the full schema.
