# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2026-03-25

### Added

- **Per-gate timeout override in `.hone-gates.json`** — individual gates can
  now declare a `timeout` field (milliseconds) to override the global
  `gateTimeout` setting. Useful when one gate (e.g. a security scan) needs a
  longer window than the rest.

### Changed

- **TypeScript updated to 6.0.2** — dependency bump to latest TypeScript.
- **Gates file I/O extracted to single module** — `src/gates-file.ts` now owns
  all reads and writes of `.hone-gates.json`, eliminating duplicated file
  access logic across command handlers.

### Fixed

- **Single source of truth for version** — `VERSION` constant in
  `src/constants.ts` is now derived from `package.json` instead of being
  hardcoded. Eliminates version drift that caused `--version` to report stale
  values and `hone init` to stamp skills with an incorrect version.
- **TypeScript typecheck error for `.md` text imports** — resolved type
  error introduced by stricter handling in newer TypeScript versions.

## [1.2.2] - 2026-03-17

### Added

- **`hone init` command for skill distribution** — installs the hone skill
  into a project's `.claude/skills/hone/` directory with version stamping,
  version guard (blocks accidental downgrades unless `--force`), and
  `--global`/`--force` flags. Extracted `VERSION` constant into
  `src/constants.ts` for shared use.
- **CHARTER.md reference warning** — the charter check now verifies that
  `CHARTER.md` is `@`-referenced in the project's `AGENTS.md` or `CLAUDE.md`
  so the LLM can see it during assessment. Emits a non-blocking warning when
  the reference is missing.

### Changed

- **Consolidated verify-retry loop** — extracted the shared verify/retry logic
  from `iterate` and `maintain` into a single `src/verify-loop.ts` module,
  eliminating duplication and adding dedicated tests.

### Fixed

- **Dependency updates** — bumped esbuild, @types/bun, rollup, vitepress, and
  other transitive dependencies to latest compatible versions.

## [1.2.1] - 2026-02-21

### Fixed

- **Plan stage prompt hardened against file creation** — strengthened language to
  explicitly prohibit the agent from writing plan files (PLAN.md, etc.) during
  the planning stage. The complete plan must appear in the agent's printed output
  so it is captured for audit records and GitHub issues.

## [1.2.0] - 2026-02-20

### Added

- **Lockfile detection in `hone derive`** — scans for 10 lockfile types
  (bun.lockb, uv.lock, poetry.lock, yarn.lock, etc.) and maps them to package
  managers. Included in the derive prompt so Claude has explicit runtime/tooling
  signals for better agent naming.
- **Stronger agent naming convention** — derive prompt now instructs Claude to
  use `<runtime-or-pkg-manager>-<language>-<framework>-craftsperson` pattern
  (e.g., `bun-typescript-react-craftsperson`, `uv-python-fastapi-craftsperson`)
  instead of generic `<language>-craftsperson`.
- **`--name` flag for `hone derive`** — override the agent name Claude generates
  (e.g., `hone derive . --name uv-python-qt-craftsperson`).
- **Agent name conflict detection** — before writing, checks if an agent with
  the same name already exists in the target directory. In JSON mode, outputs a
  structured error. In interactive mode, presents four resolution options:
  overwrite, expand name (haiku call for a more specific name), merge principles
  into existing agent (via `mix()`), or abort.
- **Existing agent names passed to derive prompt** — Claude sees which agent
  names already exist and naturally avoids collisions.

## [1.1.5] - 2026-02-20

### Fixed

- **`hone derive` now defaults to `--local`** — the code was inverted, writing
  agents to `~/.claude/agents/` (global) by default despite the README and help
  text documenting `--local` as the default. Now `--local` is the actual default
  and `--global` must be passed explicitly.

## [1.1.4] - 2026-02-18

### Fixed

- **Re-resolve gates on each verify attempt** — the verify loop now re-reads
  `.hone-gates.json` before each gate run, so if the agent legitimately fixes a
  gate definition (e.g. updating a stale simulator name), the updated commands
  are used on subsequent retries. Previously, gates were cached at startup and
  never refreshed, causing infinite retry loops when the fix was in the gate
  config itself. Affects both `iterate` and `maintain` commands.

## [1.1.3] - 2026-02-18

### Changed

- **Enrich retry prompts with cumulative attempt history** — retry prompts now
  include the project folder, assessment/gate definitions, and a history of all
  prior failed attempts so the agent can see patterns in its failures. Also
  passes cwd to Claude subprocesses so they run in the target project directory.

## [1.1.2] - 2026-02-16

### Changed

- **Standardize on `*.md` for agents** — `hone derive` now writes `<name>.md`
  instead of `<name>.agent.md`. When both extensions exist for the same agent,
  `.md` is preferred over `.agent.md`. Existing `.agent.md` files continue to
  work for backward compatibility.

## [1.1.1] - 2026-02-16

### Fixed

- **Mix command no longer clobbers local agent content** — the mix command now
  gives Claude write access to edit the agent file directly using the Edit tool,
  instead of asking it to reproduce the entire file as stdout. Previously, Claude
  would summarize or abbreviate sections it wasn't asked to change, losing content.

## [1.1.0] - 2026-02-16

### Added

- **`hone derive-gates` command** — generates `.hone-gates.json` by inspecting
  the project's actual tooling (package scripts, CI configs, tool configs,
  Makefiles) with a single Claude call. Unlike `derive`, this skips agent
  generation entirely. Optionally accepts an agent name for context prioritization.
  Supports `--run` to validate gates after generation and `--derive-model` to
  override the model.

## [1.0.0] - 2026-02-15

### Added

- **`--audit-dir` flag** — configurable audit log directory for `iterate`,
  `maintain`, and `history` commands. Accepts relative paths (joined to project
  dir) or absolute paths. Useful for redirecting audit logs out of the repo when
  running automated iterations via cron or CI.

## [0.7.0] - 2026-02-15

### Added

- **`headline` and `summary` in JSON output** — successful iterate and maintain
  runs now include LLM-generated `headline` (max 72 chars, imperative) and
  `summary` (2-5 lines) fields for use as git commit messages. Generated by a
  new summarize stage (haiku, read-only, no agent) that runs after successful
  verify. Override the model with `--summarize-model`.

## [0.6.0] - 2026-02-15

### Added

- **`hone maintain` command** — proactive dependency maintenance that sends
  Claude to update project dependencies and verifies quality gates still pass.
  Unlike `iterate`, there is no assess/triage/plan pipeline — it goes straight
  to execution with a verify/retry loop. Requires gates to be configured.
  `hone maintain <agent> <folder> [--max-retries N] [--execute-model M]`

## [0.5.1] - 2026-02-15

### Fixed

- **Agent deduplication** — when both `foo.agent.md` and `foo.md` exist,
  `.agent.md` is now preferred instead of listing both as separate agents.
- **Local agent discovery in iterate** — `hone iterate` now checks
  `<folder>/.claude/agents/` in addition to `~/.claude/agents/`, so agents
  created with `hone derive --local` are found without copying them globally.

## [0.5.0] - 2026-02-15

### Added

- **`hone mix` command** — augment a local agent with ideas from a global agent.
  `hone mix <agent> <folder> --from <foreign-agent> --principles --gates`
  selectively mixes engineering principles and/or quality gates. Separate Claude
  calls per aspect prevent cross-contamination. Gate extraction distinguishes
  parse failures from empty results to avoid clobbering existing gate files.
- **Shared preamble module** — charter check and preflight gate validation
  extracted into `src/preamble.ts`, shared by both iterate and github-iterate.

### Changed

- **Derive refactored to exploration-based** — instead of stuffing file contents
  into the prompt, derive now gives Claude read tools (Read, Glob, Grep) and
  file hints, producing better agents from actual code inspection.
- **Derive defaults to global agent placement** — `hone derive` now writes the
  agent to `~/.claude/agents/` by default so `hone iterate` can discover it
  without `--global`. Use `--local` to write to `<folder>/.claude/agents/`.
- **Gates model upgraded to sonnet** — gate extraction uses sonnet instead of
  haiku for more reliable command parsing.

## [0.4.3] - 2026-02-03

### Changed

- **Derive defaults to local agent placement** — `hone derive` now writes the
  agent to `<folder>/.claude/agents/` by default instead of `~/.claude/agents/`.
  Use `--global` to write to the global agents directory.

## [0.4.2] - 2026-02-03

### Changed

- **Derive model upgraded to opus** — agent generation is a high-stakes
  analytical task that runs once per project; opus produces better agent names
  and more accurate gate commands than sonnet.
- **Derive prompt improvements** — explicit naming convention guidance
  (`<primary-technology>-craftsperson`) with examples, and QA checkpoint
  instructions that direct the LLM to use actual project scripts instead of
  hallucinating commands.
- **Shell script context** — `hone derive` now reads `.sh` files at the project
  root and includes their contents in the prompt, giving the LLM concrete
  build/test commands to reference.

## [0.4.1] - 2026-02-03

### Added

- **Preflight gate validation** — gates are resolved and run against the
  unmodified codebase before any LLM work. If required gates fail before
  changes are made, hone stops immediately instead of burning tokens on an
  agent that can't fix environment problems. Skipped with `--skip-gates`.
- **Gate validation in `hone derive`** — after generating `.hone-gates.json`,
  runs the gates and reports pass/fail for each so the user can fix before
  iterating.

### Changed

- `runExecuteWithVerify` now receives pre-resolved gates instead of a gate
  resolver, eliminating redundant resolution during the verify loop.

## [0.4.0] - 2026-02-02

### Added

- **GitHub mode** — `--mode github` creates GitHub issues from proposals,
  supports thumbs-up/thumbs-down approval workflow, and executes approved
  backlog with automatic commits
- **Charter check** — verifies project has sufficient intent documentation
  before iterating; skip with `--skip-charter`
- **Triage stage** — filters low-severity and busy-work proposals via severity
  threshold and LLM-based classification; skip with `--skip-triage`
- **`--json` output mode** — all commands support structured JSON output to
  stdout with progress on stderr
- **Shared `runProcess` utility** — consolidated subprocess spawning into
  `src/process.ts`, eliminating duplication across claude, gates, and github
  modules

### Changed

- `githubIterate()` decomposed into three focused phase functions
  (`closeRejectedIssues`, `executeApprovedIssues`, `proposeImprovements`)
- Consolidated duplicate injectable function types and test mocks into shared
  helpers
- Config display now programmatically enumerates all fields, preventing drift

### Fixed

- Proposal name now preserved through GitHub issue round-trip — audit files
  use the original kebab-case name instead of `github-N`
- Hone label is created before attempting to create GitHub issues

## [0.3.0] - 2026-02-01

### Added

- **`--save` flag for `hone gates`** — writes resolved gates to
  `.hone-gates.json` in the project folder, useful when you already have an
  agent and want a gates file without running `hone derive`
- **MIT license**
- **Local project agent** — `.claude/agents/typescript-craftsperson.agent.md`
  tailored for Bun/TypeScript CLI development
- **Security gate** — `osv-scanner` added to `.hone-gates.json` for dependency
  vulnerability scanning
- **Release process** documented in CLAUDE.md

## [0.2.0] - 2026-02-01

### Added

- **Agent-based gate extraction** — when no `.hone-gates.json` is present, hone
  reads the agent's definition and uses Claude (haiku) to extract quality gate
  commands from its QA section
- **`hone derive <folder>`** — new command that inspects a project's structure,
  dependencies, and tooling, then generates a craftsperson agent and a
  `.hone-gates.json` file. Supports `--local` (write to project) and `--global`
  (write to `~/.claude/agents/`, the default)
- **`hone gates [agent] [folder]`** — gates command now accepts an optional
  agent name as its first argument to enable agent-based gate extraction
- `gates` and `derive` model slots in configuration (`gates` defaults to haiku,
  `derive` defaults to sonnet)
- `readAgentContent()` in agents module for reading agent file contents
- Gate resolution priority chain: `.hone-gates.json` override > agent extraction
  via Claude > empty

### Changed

- `runAllGates()` now takes pre-resolved gates as its first argument instead of
  detecting them internally
- `iterate` resolves gates once before the verify loop (not on every retry)
- `buildClaudeArgs()` accepts optional agent — omits `--agent` flag when absent
- `GateRunner` type updated to accept gates array as first parameter

### Removed

- **Marker-file auto-detection** — the `AUTO_DETECT_RULES` table
  (`package.json` -> npm, `mix.exs` -> mix, etc.), `MarkerGates` interface, and
  `detectGates()` function have been removed. Gate discovery now flows through
  the override file or agent extraction

## [0.1.0] - 2025-01-27

### Added

- Initial release
- `hone iterate <agent> <folder>` — assess, plan, execute, verify cycle
- `hone gates [folder]` — detect and run quality gates
- `hone list-agents` — discover agents from `~/.claude/agents/`
- `hone history [folder]` — browse past iterations
- `hone config` — show active configuration
- Marker-file gate auto-detection (package.json, mix.exs, pyproject.toml, CMakeLists.txt)
- `.hone-gates.json` override support
- Retry loop with failure context for gate enforcement
- Audit trail output (assessment, plan, actions, retries)
