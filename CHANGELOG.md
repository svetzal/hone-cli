# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
