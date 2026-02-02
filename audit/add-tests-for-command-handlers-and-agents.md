I've now read every source file and every test file in the project. Let me compile my assessment.

---

## Assessment: hone-cli against TypeScript Craftsperson Principles

### Overall Impression

This is a well-structured, well-documented codebase. All 72 tests pass, strict TypeScript is clean, the architecture follows functional core/imperative shell patterns, and dependency injection enables excellent testability of core logic. The code communicates intent well, module boundaries are clear, and there is no speculative abstraction. This is quality work.

That said, one principle stands out as the most violated.

---

### Most Violated Principle: **Tests Are the Executable Spec**

Specifically: **The command handlers (the imperative shell) have zero test coverage, and `agents.ts` has no tests either — leaving 7 of 17 modules unverified.**

Here's the test coverage gap:

| Module | Lines | Has Tests? |
|--------|-------|------------|
| `commands/iterate.ts` | 62 | ❌ |
| `commands/gates.ts` | 91 | ❌ |
| `commands/derive.ts` | 61 | ❌ |
| `commands/list-agents.ts` | 18 | ❌ |
| `commands/history.ts` | 28 | ❌ |
| `commands/config.ts` | 19 | ❌ |
| `agents.ts` | 58 | ❌ |

That's **~337 lines of untested production code** — roughly 25% of the source. The core modules (`iterate.ts`, `gates.ts`, `resolve-gates.ts`, etc.) are well-tested because they accept injectable dependencies. But the command handlers — which wire things together, validate arguments, apply flag overrides, and handle error paths — have no tests at all.

#### Why this matters

The command handlers aren't trivial. They contain **real logic** that can break:

1. **`commands/gates.ts`** (91 lines) has a nuanced argument-detection heuristic that distinguishes agent names from folder paths by checking for `/` and `.` characters. If this logic is wrong, the command silently does the wrong thing. It also has a `--save` flag that writes to disk — untested.

2. **`commands/iterate.ts`** applies flag overrides (`--max-retries`, `--assess-model`, etc.) by mutating the config object. An incorrect `parseInt` or a missing flag name would silently use defaults — and there's no test to catch it.

3. **`commands/derive.ts`** handles `--local` vs `--global` agent placement with directory creation — a failure here would write agents to the wrong location.

4. **`agents.ts`** is a dependency of multiple other modules (`extract-gates.ts`, `commands/iterate.ts`, `commands/list-agents.ts`). The `agentNameFromFile` function has parsing logic (`.agent.md` vs `.md` suffixes), `agentExists` depends on `listAgents`, and `readAgentContent` does file I/O — all untested.

#### What's *not* the problem

The core iteration logic is excellent. The dependency injection pattern (`gateRunner`, `gateResolver`, `ClaudeInvoker`) is well-applied. The tests for `iterate.ts` (18 tests, 539 lines) are thorough and verify real behavioral scenarios. The functional core is solid.

The gap is specifically at the **shell boundary** — the thin-but-not-trivial wiring layer.

---

### How to Correct It

**1. Add tests for `agents.ts`** — This is the highest-value target because it's a shared dependency:
- Test `agentNameFromFile` with `.agent.md`, `.md`, and non-markdown files
- Test `listAgents` with a temp directory containing various file types
- Test `agentExists` (true/false cases)
- Test `readAgentContent` (found/not-found cases)
- The module currently hardcodes `AGENTS_DIR` to `~/.claude/agents/` — to make it testable, inject the directory path (or make it a parameter with a default).

**2. Add tests for command handlers** — These should mock their dependencies and verify:
- Argument validation (missing agent, missing folder → `process.exit(1)`)
- Flag parsing and config override application
- Error paths (agent not found, invalid flags)
- For `commands/gates.ts`: the agent-vs-folder detection heuristic

**3. Make `agents.ts` injectable** — The hardcoded `AGENTS_DIR` constant makes the module untestable without touching the real filesystem at `~/.claude/agents/`. Refactor to accept the agents directory as a parameter (with `~/.claude/agents/` as the default), matching the dependency injection pattern already used throughout the rest of the codebase.

**Priority order:**
1. `agents.ts` (shared dependency, needs DI refactor + tests)
2. `commands/gates.ts` (most complex command handler, has subtle argument heuristic)
3. `commands/iterate.ts` (flag override logic)
4. `commands/derive.ts` (--local/--global path logic)
5. `commands/list-agents.ts`, `commands/history.ts`, `commands/config.ts` (simpler, lower risk)

This correction maintains the existing architecture style — the codebase already demonstrates how to inject dependencies and test against them. It's a matter of applying that same pattern consistently to the remaining 7 untested modules.