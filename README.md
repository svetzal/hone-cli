# Hone

A CLI that hones your codebase one principle at a time.

You point it at a project and an agent. It finds the engineering principle your
code violates most, plans a fix, executes it, and then — critically — runs your
quality gates itself to make sure the agent didn't break anything. If a gate
fails, it sends the agent back with the failure output until it gets it right.

The agent never self-certifies. Hone verifies independently.

## Why this exists

I wanted a simple iteration loop to illustrate the power of this loop as a
continuous improvement mechanism for projects.

Agents are naturally non-deterministic. They are unlikely to adhere to all of
your rules at the same time. They're prone to leaving things out when things get
complex.

This project wraps that non-deterministic behaviour in a more deterministic loop.
The agent doesn't decide for itself when it's done. The quality gates do. And
they're deterministic.

The iteration is a mechanism to push your implementation closer to the guardrails
you intended in your custom agent definition and AGENTS.md files.

Hone is an attempt to package up a way to do iteration like this in as simple a
form as possible.

The key insight: an agent will happily tell you it implemented all your policies,
passed all your guardrails and validations, or confidently tell you why some of
them don't matter. Hone diligently runs all of your validations every time, and the
iteration pushes your implementation closer to your policies and intent.

## Prerequisites

Hone delegates to the [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
CLI (`claude`), which must be installed and authenticated. We recommend using the
Claude Max plan if you want to do regular iteration on your codebase.

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

## Quick start

```bash
# See what agents you have
hone list-agents

# Generate an agent and gates for a project you don't have an agent for yet
hone derive /path/to/project

# See what gates hone would enforce on a project
hone gates /path/to/project

# Run one improvement iteration
hone iterate typescript-craftsperson /path/to/project
```

That single `iterate` command does five things:

1. **Assess** — Opus reads your code (read-only) and identifies the most
   violated engineering principle
2. **Name** — Haiku generates a kebab-case filename summarizing the issue
3. **Plan** — Opus creates a step-by-step correction plan (still read-only)
4. **Execute** — Sonnet applies the plan (full write access)
5. **Verify** — Hone runs your quality gates; if any required gate fails, it
   sends the agent back to fix with the failure output as context

Steps 4-5 repeat up to `--max-retries` times (default: 3).

## Commands

### `hone iterate <agent> <folder>`

The main event. Runs one improvement cycle.

```bash
hone iterate python-craftsperson .
hone iterate elixir-phoenix-craftsperson ./apps/web --skip-gates
hone iterate typescript-craftsperson ./src --max-retries 5
hone iterate cpp-qt-craftsperson . --execute-model opus
```

Options:

| Flag | Default | Purpose |
|------|---------|---------|
| `--max-retries <n>` | 3 | How many times to retry after gate failures |
| `--skip-gates` | off | Skip verification entirely (assess + execute only) |
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

Inspects a project and generates a craftsperson agent tailored to its tech
stack, along with a `.hone-gates.json` file containing the appropriate quality
gates.

```bash
hone derive .                # Agent goes to ~/.claude/agents/ (default)
hone derive . --local        # Agent goes to ./.claude/agents/
```

This is the fastest way to get started with a new project. Derive examines your
directory structure, package manager files, CI configuration, and linter/formatter
configs, then asks Claude to generate an agent with principles and QA checkpoints
appropriate for your stack.

Options:

| Flag | Default | Purpose |
|------|---------|---------|
| `--local` | off | Write agent to `<folder>/.claude/agents/` |
| `--global` | on | Write agent to `~/.claude/agents/` |

### `hone gates [agent] [folder]`

Shows what quality gates hone would enforce, runs them, or saves them to a file.

```bash
hone gates .                              # Show gates from .hone-gates.json
hone gates typescript-craftsperson .      # Show gates (override or extracted from agent)
hone gates . --run                        # Actually run them and report pass/fail
hone gates typescript-craftsperson . --save       # Extract from agent, write .hone-gates.json
hone gates typescript-craftsperson . --save --run  # Extract, save, then run them
```

When an agent name is provided, hone uses the full gate resolution chain
(override file, then agent extraction). Without an agent, it only reads the
`.hone-gates.json` override file.

Options:

| Flag | Default | Purpose |
|------|---------|---------|
| `--run` | off | Run the gates and report pass/fail |
| `--save` | off | Write resolved gates to `.hone-gates.json` in the project folder |

The `--save` flag writes the resolved gates to `.hone-gates.json` in the project
folder. This is useful when you already have an agent and want to generate a
gates file without running `hone derive`.

### `hone list-agents`

Lists agents available in `~/.claude/agents/`.

### `hone history [folder]`

Shows past iterations from the audit directory, most recent first.

### `hone config`

Prints the active configuration (defaults merged with `~/.config/hone/config.json`).

## Quality gates

Hone resolves gates using a priority chain:

1. **`.hone-gates.json`** — If present in the project root, these gates are used
   directly. No Claude call needed, and the file can be version-controlled with
   the project.
2. **Agent extraction** — If no override file exists, hone reads the agent's
   definition file and uses Claude (haiku) to extract QA gate commands from its
   principles and checkpoints section.
3. **Empty** — If neither source provides gates, hone reports no gates found and
   skips verification.

The recommended workflow is to run `hone derive .` on a new project. This
generates both an agent and a `.hone-gates.json`, giving you explicit,
version-controlled gate definitions that don't require a Claude call on every
iteration. If you already have an agent, use `hone gates <agent> . --save` to
generate just the gates file.

### Gate file format

Drop a `.hone-gates.json` in your project root:

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

Gates marked `required: true` trigger the retry loop on failure. Optional gates
(`required: false`) are reported but don't block.

## Configuration

Defaults live in `~/.config/hone/config.json`. All fields are optional — missing
fields use built-in defaults:

```json
{
  "models": {
    "assess": "opus",
    "name": "haiku",
    "plan": "opus",
    "execute": "sonnet",
    "gates": "haiku",
    "derive": "sonnet"
  },
  "auditDir": "audit",
  "readOnlyTools": "Read Glob Grep WebFetch WebSearch",
  "maxRetries": 3,
  "gateTimeout": 120000
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

You can get agents three ways:

1. **`hone derive`** — generate one from your project's structure and tooling
2. **Pre-built agents** — grab quality-focused agents from
   [svetzal/guidelines](https://github.com/svetzal/guidelines/tree/main/agents)
   and copy any `*.md` file into `~/.claude/agents/`
3. **Write your own** — create a markdown file in `~/.claude/agents/` with
   principles and QA checkpoints for your domain

## How the retry loop works

When execution finishes, hone runs every resolved gate as a subprocess. If a
required gate fails, the agent gets a retry prompt containing:

1. The original plan
2. Which gates failed
3. The captured output (last 200 lines of stdout + stderr)
4. An instruction to fix the failures without regressing on the original fix

This means the agent doesn't re-assess from scratch — it gets targeted feedback
and course-corrects. Each retry's output is saved separately
(`<name>-retry-N-actions.md`) so you can trace what happened.

## Development

```bash
bun install                   # Install dependencies
bun test                      # Run tests (72 tests across 9 files)
bunx tsc --noEmit             # Type check
bun run dev -- list-agents    # Run without building
bun run build                 # Build local executable
bun run build:all             # Build for all platforms (macOS/Linux/Windows)
```
