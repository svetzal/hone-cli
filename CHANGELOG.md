# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
