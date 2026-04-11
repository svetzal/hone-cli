# Hone

Why this project exists and what problem does it solve: @CHARTER.md

What this project currently is and how to use it: @README.md

This file is about how this project is intended to be managed.

---

CLI tool that hones codebases through iterative quality improvement cycles using
Claude agents. Each iteration assesses a project against engineering principles,
identifies the most violated principle, plans a correction, executes it, and
verifies all quality gates pass before considering the work complete.

## Architecture

### Iteration Workflow

Each `hone` call runs an **outer improvement loop** and an **inner enforcement loop**.

#### Outer Loop: Improvement Cycle

Identifies and fixes the most violated engineering principle:

| Stage | Purpose | Model | Tools | Output |
|-------|---------|-------|-------|--------|
| **Charter Check** | Verify project has intent documentation | — | Read-only | pass/fail |
| **Preflight** | Resolve gates, run against unmodified codebase — fail fast if broken | — | — | pass/fail |
| **Assess** | Evaluate project against agent's principles, identify most violated | opus | Read-only | `<name>.md` |
| **Name** | Generate kebab-case filename summarizing the issue | haiku | Read-only | filename string |
| **Triage** | Filter low-severity and busy-work proposals | haiku | Read-only | pass/reject |
| **Plan** | Create step-by-step correction plan from assessment | opus | Read-only | `<name>-plan.md` |
| **Execute** | Apply the plan — make actual code changes | sonnet | All | `<name>-actions.md` |
| **Verify** | Run quality gates, loop until clean | — | — | gate results |
| **Summarize** | Generate headline + summary for commit messages (on success only) | haiku | Read-only | `headline`, `summary` |

Read-only tools: `Read Glob Grep WebFetch WebSearch`

#### Inner Loop: Quality Gate Enforcement

After execution, the tool runs the project's quality gates directly (not via Claude).
If any gate fails, the agent is sent back to fix with the failure output as context.
This repeats until all gates pass or `--max-retries` is reached (default: 3).

```
Execute
  ↓
Run quality gates (test, lint, security, docs)
  ↓
All pass? → Done ✓
Any fail? → Send failure output back to agent → Execute again
  ↓
Max retries exceeded? → Stop, report remaining failures
```

**The agent never self-certifies.** The tool independently verifies every gate.

#### Quality Gates

Gates are project-specific commands detected by convention or declared in config.
The tool runs each command, checks exit codes, and captures stderr/stdout on failure.

**Auto-detection** (checks which files exist in the project root):

| Detected File | Test | Lint | Security |
|---------------|------|------|----------|
| `package.json` | `npm test` | `npm run lint` | `npm audit --audit-level=moderate` |
| `mix.exs` | `mix test` | `mix credo --strict && mix format --check-formatted` | `mix deps.audit && mix hex.audit && mix sobelow --config` |
| `pyproject.toml` | `pytest` | `ruff check src && ruff format --check src` | `pip-audit` |
| `CMakeLists.txt` | `ctest --output-on-failure` | `cppcheck --enable=all --error-exitcode=1 src/` | — |

#### Retry Prompt Strategy

When a gate fails, the retry prompt to the agent includes:

1. The original plan (what was being fixed)
2. Which gate(s) failed
3. The captured output (stderr + stdout, truncated to last 200 lines)
4. Instruction: fix the failures without regressing on the original fix

This gives the agent full context to course-correct without re-assessing from scratch.

### How It Delegates

The tool shells out to the `claude` CLI:

```bash
# Assessment phase (read-only, captured output)
claude --agent <agent> --model opus --print \
  --allowedTools "Read Glob Grep WebFetch WebSearch" \
  -p "<assessment prompt>"

# Execution phase (write access, interactive)
claude --dangerously-skip-permissions --agent <agent> --model sonnet \
  -p "<execution prompt with assessment + plan>"
```

## Local Installation

```bash
brew tap svetzal/tap
brew install hone
```

To upgrade: `brew upgrade hone`

## Tech Stack

- **Runtime:** Bun (TypeScript, compiles to native executable)
- **Distribution:** Homebrew tap (`mojility/tap`)
- **Testing:** Bun test runner
- **No external dependencies** beyond Bun stdlib where possible

## Project Structure

```
src/
  cli.ts              # Entry point, argument parsing, help
  constants.ts        # Shared constants (VERSION)
  types.ts            # Shared type definitions
  iterate.ts          # Core iteration workflow (outer + inner loops)
  claude.ts           # Claude CLI subprocess wrapper
  agents.ts           # Agent discovery (~/.claude/agents/)
  gates.ts            # Quality gate detection, execution, result capture
  audit.ts            # Audit output management (read/write/list)
  config.ts           # Configuration loading/defaults
  commands/
    init.ts           # init command handler (skill installation)
    iterate.ts        # iterate command handler
    list-agents.ts    # list-agents command handler
    gates.ts          # gates command handler
    history.ts        # history command handler
    config.ts         # config command handler
skills/
  hone/
    SKILL.md          # Source of truth for the hone skill (metadata.version synced with tool version)
package.json
tsconfig.json
```

## Skill Distribution

Hone distributes a Claude Code skill that provides usage guidance to Claude
when users invoke hone through conversational prompts.

- **Source of truth:** `skills/hone/SKILL.md` in the repo root
- **Install:** `hone init` (local, to `.claude/skills/hone/`) or `hone init --global` (to `~/.claude/skills/hone/`)
- **Build-time embedding:** The skill content is embedded in the binary via Bun text imports — no file reads at runtime
- **Version stamping:** `hone init` injects `hone-version: <VERSION>` into the SKILL.md frontmatter at install time and updates `metadata.version` to match. The skill `metadata.version` must always match the tool version in `package.json`.
- **Version guard:** If the installed skill has a newer `hone-version` than the running binary, `hone init` refuses to overwrite (warns the user). Use `--force` to bypass.
- `.claude/skills/hone/` is gitignored — it is a generated artifact, not source

## Agent Contract

Agents live in `~/.claude/agents/*.md` and must:
- Define engineering principles for their domain
- Include a quality assessment prompt structure
- Specify mandatory QA checkpoints
- Be usable with both read-only and full tool sets

The tool does not modify or manage agents — it discovers and delegates to them.

## Release Process

Releases follow semver. To create a new release:

1. All quality gates must pass (`bun test`, `bunx tsc --noEmit`)
2. Working tree must be clean — all changes committed to `main`
3. Update the version in `package.json` and `skills/hone/SKILL.md` (`metadata.version`). The `VERSION` constant in `src/constants.ts` is derived automatically from `package.json`.
4. Verify `skills/hone/SKILL.md` content is current — review commands, flags, and workflows against the actual CLI
5. Move the `[Unreleased]` section in `CHANGELOG.md` under a dated version heading (e.g. `## [0.3.0] - 2026-02-01`)
6. Commit: `Release v0.3.0`
7. Tag: `git tag v0.3.0`
8. Push: `git push origin main --tags`
9. Build and install locally: `bun run build && cp build/hone /usr/local/bin/hone` — don't wait for Homebrew

CI handles the rest automatically when a `v*` tag is pushed:
- Builds cross-platform binaries (macOS arm64/x64, Linux x64, Windows x64)
- Creates a GitHub Release with the binaries attached
- Updates the Homebrew tap (`svetzal/homebrew-tap`) with new checksums

## Event Tracking

Hone emits structured events to the Operations event stream (`~/Work/Operations/Events/intake/YYYY-MM.jsonl`)
to enable cross-project visibility and integration with other Mojility skills.

### Event Types

| Event | When Emitted | Key Data |
|-------|-------------|----------|
| `hone_iteration_started` | After preamble passes | iterationId, project, agent, mode, gatesFound |
| `hone_assessment_completed` | After assessment stage | severity, principle, category, auditFile |
| `hone_triage_completed` | After triage decision | accepted, changeType, busyWork, reason |
| `hone_execution_completed` | After execute+verify loop | success, retries, gatesPassed, gateResults |
| `hone_proposal_created` | GitHub mode: issue filed | issueNumber, issueTitle, severity, principle |
| `hone_proposal_executed` | GitHub mode: approved & applied | issueNumber, commitSha, success, retries |

### Client Derivation

Events automatically derive the `client.name` field from the project path:

| Project Path | Client Name |
|-------------|-------------|
| `Projects/Clients/ORT/*` | `ORT` |
| `Projects/Clients/ContinuousCoaching/*` | `ContinuousCoaching` |
| `Projects/Clients/Elevate21/*` | `Elevate21` |
| `Projects/Clients/HaliburtonElectric/*` | `HaliburtonElectric` |
| `Projects/Clients/Reaction/*` | `Reaction` |
| `Projects/Mojility/*` | `Mojility` |
| `Projects/Personal/*` | `personal` |

### Graceful Fallback

When hone-cli runs outside the Operations repository (cannot find the event stream),
events are silently skipped with a warning to stderr. Hone continues to work normally
but does not emit events.

### Audit Files

The existing audit markdown files remain as detailed artifacts. Events capture the
structured facts (what happened, severity, outcome), while audit files hold the
unstructured detail (full assessment prose, execution logs). Events reference audit
files by relative path in the `auditFile` field.

## Client Code

`mojility` — this is internal Mojility tooling.
