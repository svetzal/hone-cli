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
| **Assess** | Evaluate project against agent's principles, identify most violated | opus | Read-only | `<name>.md` |
| **Name** | Generate kebab-case filename summarizing the issue | haiku | Read-only | filename string |
| **Triage** | Filter low-severity and busy-work proposals | haiku | Read-only | pass/reject |
| **Plan** | Create step-by-step correction plan from assessment | opus | Read-only | `<name>-plan.md` |
| **Execute** | Apply the plan — make actual code changes | sonnet | All | `<name>-actions.md` |
| **Verify** | Run quality gates, loop until clean | — | — | gate results |

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

## Tech Stack

- **Runtime:** Bun (TypeScript, compiles to native executable)
- **Distribution:** Homebrew tap (`mojility/tap`)
- **Testing:** Bun test runner
- **No external dependencies** beyond Bun stdlib where possible

## Project Structure

```
src/
  cli.ts              # Entry point, argument parsing, help
  types.ts            # Shared type definitions
  iterate.ts          # Core iteration workflow (outer + inner loops)
  claude.ts           # Claude CLI subprocess wrapper
  agents.ts           # Agent discovery (~/.claude/agents/)
  gates.ts            # Quality gate detection, execution, result capture
  audit.ts            # Audit output management (read/write/list)
  config.ts           # Configuration loading/defaults
  commands/
    iterate.ts        # iterate command handler
    list-agents.ts    # list-agents command handler
    gates.ts          # gates command handler
    history.ts        # history command handler
    config.ts         # config command handler
package.json
tsconfig.json
```

## Agent Contract

Agents live in `~/.claude/agents/*.agent.md` and must:
- Define engineering principles for their domain
- Include a quality assessment prompt structure
- Specify mandatory QA checkpoints
- Be usable with both read-only and full tool sets

The tool does not modify or manage agents — it discovers and delegates to them.

## Release Process

Releases follow semver. To cut a release:

1. All quality gates must pass (`bun test`, `bunx tsc --noEmit`)
2. Working tree must be clean — all changes committed to `main`
3. Update the version in `package.json` and `src/cli.ts` (`VERSION` constant)
4. Move the `[Unreleased]` section in `CHANGELOG.md` under a dated version heading
5. Commit the version bump (e.g. `Bump version to 0.3.0`)
6. Create a git tag: `git tag v0.3.0`
7. Push the commit and tag: `git push && git push --tags`
8. Create a GitHub release on the tag: `gh release create v0.3.0 --title "v0.3.0" --notes-from-tag`

The `--notes-from-tag` flag pulls release notes from the tag. Alternatively,
pass the changelog section content via `--notes`.

## Client Code

`mojility` — this is internal Mojility tooling.
