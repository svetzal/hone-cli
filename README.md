# Hone

A CLI that hones your codebase one principle at a time.

You point it at a project and an agent. It finds the engineering principle your
code violates most, plans a fix, executes it, and then — critically — runs your
quality gates itself to make sure the agent didn't break anything. If a gate
fails, it sends the agent back with the failure output until it gets it right.

The agent never self-certifies. Hone verifies independently.

See [CHARTER.md](CHARTER.md) for the design rationale behind these choices.

## Prerequisites

Hone currently delegates to the [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
CLI (`claude`), which must be installed and authenticated. We recommend using the
Claude Max plan if you want to do regular iteration on your codebase.

For GitHub mode, the [GitHub CLI](https://cli.github.com/) (`gh`) must also be
installed and authenticated.

## Install

### macOS (Homebrew)

```bash
brew tap svetzal/tap
brew install hone
```

### Linux

Download the binary from the
[latest release](https://github.com/svetzal/hone-cli/releases/latest):

```bash
curl -L https://github.com/svetzal/hone-cli/releases/latest/download/hone-linux-x64.tar.gz | tar xz
sudo mv hone-linux-x64 /usr/local/bin/hone
```

### Windows

Download `hone-windows-x64.exe` from the
[latest release](https://github.com/svetzal/hone-cli/releases/latest) and add it
to your PATH.

### From source

Requires [Bun](https://bun.sh):

```bash
bun install
bun run build    # produces build/hone
```

## Getting started with a new project

The fastest path from zero to iterating:

```bash
# 1. Generate an agent and quality gates for your project
hone derive /path/to/project

# 2. Review what was generated
hone list-agents
hone gates /path/to/project

# 3. Run your first improvement iteration
hone iterate <agent-name> /path/to/project
```

`hone derive` examines your directory structure, package manager files, CI
configuration, and linter/formatter configs, then generates an agent with
principles and QA checkpoints appropriate for your stack, plus a
`.hone-gates.json` file.

If you already have an agent (from
[svetzal/guidelines](https://github.com/svetzal/guidelines/tree/main/agents) or
written by hand), skip derive and go straight to iterating.

## The iteration pipeline

Each `hone iterate` invocation runs this pipeline:

```
Charter Check → Preflight → Assess → Name → Triage → Plan → Execute → Verify
```

| Stage | What happens | Model | Access |
|-------|-------------|-------|--------|
| **Charter Check** | Verifies the project has intent documentation | none (heuristic) | read-only |
| **Preflight** | Resolves gates, runs them against unmodified codebase — fails fast if broken | none (subprocess) | — |
| **Assess** | Identifies the most violated principle, produces a severity rating | opus | read-only |
| **Name** | Generates a kebab-case filename for audit records | haiku | read-only |
| **Triage** | Filters out low-severity and busy-work proposals | haiku | read-only |
| **Plan** | Creates a step-by-step correction plan | opus | read-only |
| **Execute** | Applies the plan | sonnet | full |
| **Verify** | Runs quality gates; retries on failure | none (subprocess) | — |

Execute and Verify repeat up to `--max-retries` times (default: 3).

### Charter check

Before any assessment, hone checks for intent documentation — a CHARTER.md, a
CLAUDE.md with a `## Project Charter` section, a README.md, or a description
field in your package manager config. If nothing meets the minimum length
threshold (default: 100 characters), hone stops with guidance on what to add.

Skip with `--skip-charter`. Adjust the threshold with `--min-charter-length`.

### Preflight

After the charter check but before any LLM work, hone resolves quality gates and
runs them against the unmodified codebase. If required gates fail before any
changes are made, the gates themselves are broken (missing tools, wrong paths,
pre-existing failures) — there's no point sending an agent to fix environment
problems it can't fix.

Preflight is skipped when `--skip-gates` is set or when no gates are resolved.

### Triage

After assessment, proposals pass through a two-layer filter:

1. **Severity threshold** — Proposals rated below the threshold (default: 3 on
   a 1-5 scale) are rejected immediately with no LLM call.

2. **Busy-work detection** — A separate LLM pass classifies the change and
   rejects busy-work categories: adding comments to unchanged logic,
   reorganizing imports, adding abstractions for single-use code, and
   "consistency" refactors that don't fix bugs or enable features.

When triage rejects a proposal, hone exits with `success: true` — the codebase
is in good shape relative to the agent's principles.

Skip with `--skip-triage`. Adjust the severity bar with `--severity-threshold`.

### Retry loop

When a required gate fails after execution, the agent gets a retry prompt with
the original plan, which gates failed, and the captured output (last 200 lines).
Each retry is saved separately (`<name>-retry-N-actions.md`).

## Local mode vs GitHub mode

### Local mode (default)

Proposals that pass triage are executed immediately. One proposal per invocation.

```bash
hone iterate typescript-craftsperson ./src
```

### GitHub mode

Proposals become GitHub issues. The repo owner approves via thumbs-up reaction,
rejects via thumbs-down. No code changes happen without sign-off.

```bash
hone iterate typescript-craftsperson ./src --mode github
hone iterate typescript-craftsperson ./src --mode github --proposals 3
```

Each invocation:

1. **Housekeeping** — closes any hone issues the repo owner has thumbs-downed
2. **Execute approved backlog** — processes thumbs-up issues oldest-first:
   execute, verify gates (retry loop), commit, close
3. **Propose** — assess, triage, plan, create new GitHub issue(s)

Behaviours:

- `--proposals N` (default 1) controls how many proposals per invocation. Each
  gets its own triage pass, so requesting 5 may yield 3 if two don't clear.
- Failed executions close the issue with gate output in a comment.
- Issues use the `hone` label and contain structured metadata for parsing.
- Hone doesn't poll — re-invoke it via cron or CI to process approvals.

## Commands

### `hone iterate <agent> <folder>`

Runs one improvement cycle.

```bash
hone iterate python-craftsperson .
hone iterate elixir-phoenix-craftsperson ./apps/web --skip-gates
hone iterate typescript-craftsperson ./src --max-retries 5
hone iterate cpp-qt-craftsperson . --mode github --proposals 3
```

| Flag | Default | Purpose |
|------|---------|---------|
| `--mode <local\|github>` | local | Operational mode |
| `--proposals <n>` | 1 | Proposals to generate (GitHub mode only) |
| `--max-retries <n>` | 3 | Retry attempts after gate failures |
| `--skip-gates` | off | Skip quality gate verification |
| `--skip-charter` | off | Skip charter clarity check |
| `--skip-triage` | off | Skip triage (severity + busy-work filter) |
| `--severity-threshold <n>` | 3 | Minimum severity to proceed (1-5) |
| `--min-charter-length <n>` | 100 | Minimum charter content length in characters |
| `--assess-model <m>` | opus | Override the assessment model |
| `--plan-model <m>` | opus | Override the planning model |
| `--execute-model <m>` | sonnet | Override the execution model |

Each run produces audit files in `<folder>/audit/`:

```
audit/
  fix-missing-error-handling.md            # Assessment
  fix-missing-error-handling-plan.md       # Plan
  fix-missing-error-handling-actions.md    # What the agent did
  fix-missing-error-handling-retry-1-actions.md  # First retry (if gates failed)
```

### `hone derive <folder>`

Generates a craftsperson agent and `.hone-gates.json` for a project.

```bash
hone derive .                # Agent goes to ./.claude/agents/ (default)
hone derive . --global       # Agent goes to ~/.claude/agents/
```

| Flag | Default | Purpose |
|------|---------|---------|
| `--local` | on | Write agent to `<folder>/.claude/agents/` |
| `--global` | off | Write agent to `~/.claude/agents/` |

### `hone gates [agent] [folder]`

Shows, runs, or saves quality gates.

```bash
hone gates .                              # Show gates from .hone-gates.json
hone gates typescript-craftsperson .      # Show gates (override or extracted from agent)
hone gates . --run                        # Run them and report pass/fail
hone gates typescript-craftsperson . --save       # Extract from agent, write .hone-gates.json
hone gates typescript-craftsperson . --save --run  # Extract, save, then run
```

| Flag | Default | Purpose |
|------|---------|---------|
| `--run` | off | Run the gates and report pass/fail |
| `--save` | off | Write resolved gates to `.hone-gates.json` |

### `hone list-agents`

Lists agents in `~/.claude/agents/`.

### `hone history [folder]`

Shows past iterations from the audit directory, most recent first.

### `hone config`

Prints the active configuration (defaults merged with `~/.config/hone/config.json`).

## Quality gates

Gates are resolved in priority order:

1. **`.hone-gates.json`** in the project root (version-controlled, no Claude call)
2. **Agent extraction** via Claude (haiku) from the agent's QA checkpoints
3. **Empty** — no gates found, verification skipped

The recommended workflow: run `hone derive .` on a new project to get both an
agent and a gates file. If you already have an agent, use
`hone gates <agent> . --save` to generate just the gates file.

### Gate file format

```json
{
  "gates": [
    { "name": "test", "command": "bun test", "required": true },
    { "name": "typecheck", "command": "bunx tsc --noEmit", "required": true },
    { "name": "lint", "command": "bunx biome check src", "required": true },
    { "name": "security", "command": "osv-scanner .", "required": false }
  ]
}
```

`required: true` gates trigger the retry loop. `required: false` gates are
reported but don't block.

## Configuration

Defaults in `~/.config/hone/config.json` (all fields optional):

```json
{
  "models": {
    "assess": "opus",
    "name": "haiku",
    "plan": "opus",
    "execute": "sonnet",
    "gates": "haiku",
    "derive": "opus",
    "triage": "haiku"
  },
  "auditDir": "audit",
  "readOnlyTools": "Read Glob Grep WebFetch WebSearch",
  "maxRetries": 3,
  "gateTimeout": 120000,
  "mode": "local",
  "minCharterLength": 100,
  "severityThreshold": 3
}
```

CLI flags override config for that invocation.

## Agents

Hone discovers agents from `~/.claude/agents/` (both `*.agent.md` and `*.md`).
It doesn't manage or modify them — your agents define the engineering principles
that drive the assessment.

An agent should:

- Define engineering principles for its domain
- Be opinionated about what "good" looks like
- Include QA checkpoints with concrete commands (used for gate extraction)
- Work with both read-only tools (assessment/planning) and full tools (execution)

Sources:

1. **`hone derive`** — generate one from your project's structure and tooling
2. **Pre-built agents** from
   [svetzal/guidelines](https://github.com/svetzal/guidelines/tree/main/agents)
3. **Write your own** — a markdown file in `~/.claude/agents/`

## JSON output

All commands support `--json`. Progress goes to stderr, structured data to stdout.

```bash
hone iterate typescript-craftsperson . --json 2>/dev/null | jq .success
hone gates . --run --json | jq '.results[] | select(.passed == false)'
```

Local mode output includes `structuredAssessment`, `triageResult`,
`charterCheck`, and `skippedReason` fields alongside assessment, plan,
execution, and gates results.

GitHub mode output includes `housekeeping` (closed issue numbers), `executed`
(outcomes per issue), `proposed` (new issue numbers), and `skippedTriage`.

## Development

```bash
bun install                   # Install dependencies
bun test                      # Run tests
bunx tsc --noEmit             # Type check
bun run dev -- list-agents    # Run without building
bun run build                 # Build local executable
bun run build:all             # Build for all platforms (macOS/Linux/Windows)
```
