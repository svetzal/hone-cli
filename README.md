# Hone

A CLI that hones your codebase one principle at a time.

You point it at a project and an agent. It finds the engineering principle your
code violates most, plans a fix, executes it, and then — critically — runs your
quality gates itself to make sure the agent didn't break anything. If a gate
fails, it sends the agent back with the failure output until it gets it right.

The agent never self-certifies. Hone verifies independently.

## Why this exists

The iteration loop (assess → plan → execute) started as a shell script. It
worked, but it couldn't enforce quality gates, had no retry logic, no audit
trail, no configuration, and lived inside a single project. Hone extracts that
workflow into a standalone tool that adds the missing enforcement layer.

The key insight: an agent will happily tell you it passed all tests. Hone
doesn't ask — it runs them.

## Prerequisites

Hone delegates to the [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
CLI (`claude`), which must be installed and authenticated.

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
bun run build    # produces ./hone
```

## Quick start

```bash
# See what agents you have
hone list-agents

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

Steps 4–5 repeat up to `--max-retries` times (default: 3).

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

### `hone gates [folder]`

Shows what quality gates hone would enforce, or runs them.

```bash
hone gates .           # Show detected gates
hone gates . --run     # Actually run them and report pass/fail
```

### `hone list-agents`

Lists agents available in `~/.claude/agents/`.

### `hone history [folder]`

Shows past iterations from the audit directory, most recent first.

### `hone config`

Prints the active configuration (defaults merged with `~/.config/hone/config.json`).

## Quality gates

Hone auto-detects gates based on what's in your project root:

| Marker file | Test | Lint | Security |
|-------------|------|------|----------|
| `package.json` | `npm test` | `npm run lint` | `npm audit` |
| `mix.exs` | `mix test` | `mix credo --strict && mix format --check-formatted` | `mix deps.audit && mix hex.audit && mix sobelow --config` |
| `pyproject.toml` | `pytest` | `ruff check src && ruff format --check src` | `pip-audit` |
| `CMakeLists.txt` | `ctest --output-on-failure` | `cppcheck --enable=all --error-exitcode=1 src/` | — |

Test and lint gates are required (failures trigger retries). Security gates are
optional (reported but don't block).

### Custom gates

Drop a `.hone-gates.json` in your project root to override auto-detection
entirely:

```json
{
  "gates": [
    { "name": "test", "command": "bun test", "required": true },
    { "name": "typecheck", "command": "bunx tsc --noEmit", "required": true },
    { "name": "lint", "command": "bunx biome check src", "required": true },
    { "name": "security", "command": "npm audit", "required": false }
  ]
}
```

## Configuration

Defaults live in `~/.config/hone/config.json`. All fields are optional — missing
fields use built-in defaults:

```json
{
  "models": {
    "assess": "opus",
    "name": "haiku",
    "plan": "opus",
    "execute": "sonnet"
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
- Work with both read-only tools (assessment/planning) and full tools (execution)

## How the retry loop works

When execution finishes, hone runs every detected gate as a subprocess. If a
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
bun test                      # Run tests (13 tests across 5 files)
bunx tsc --noEmit             # Type check
bun run dev -- list-agents    # Run without building
bun run build                 # Build local executable
bun run build:all             # Build for all platforms (macOS/Linux/Windows)
```
