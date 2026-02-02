Now I have a thorough understanding of the codebase. Here is the complete plan:

---

## Plan: Add Test Coverage for Untested Shell Modules

### Approach

The codebase has two testability challenges in the untested modules:

1. **`agents.ts`** hardcodes `AGENTS_DIR` at module scope — it needs a DI refactor (add an optional `agentsDir` parameter) to match the pattern already used by `config.ts` (which accepts an optional `configPath`).

2. **Command handlers** call imported functions directly (`loadConfig()`, `agentExists()`, `createClaudeInvoker()`, etc.) and use `process.exit(1)` and `console.log` — making unit testing infeasible without heavy module mocking. The **right strategy** is to test these via **subprocess integration tests** (the same pattern already proven in `cli.test.ts`), which verifies the real wiring end-to-end. For the two most complex commands (`commands/gates.ts` and `commands/iterate.ts`), we will also **refactor to extract testable logic** into pure functions that can be unit-tested directly.

### Priority Order

1. `agents.ts` — shared dependency, DI refactor + unit tests
2. `commands/gates.ts` — most complex handler, extract argument parsing logic + unit tests + integration tests
3. `commands/iterate.ts` — extract flag override logic + unit tests + integration tests
4. `commands/derive.ts` — integration tests
5. `commands/list-agents.ts` — integration tests
6. `commands/history.ts` — integration tests
7. `commands/config.ts` — integration tests

---

### Step 1: Refactor `agents.ts` for Dependency Injection

**File:** `src/agents.ts`

Refactor every exported function to accept an optional `agentsDir` parameter, defaulting to `~/.claude/agents/`. This mirrors the existing pattern in `config.ts` where `loadConfig(configPath?)` accepts an optional path.

**Changes:**

1. Keep `AGENTS_DIR` as the default value but don't use it as a closure-captured constant.
2. Change `listAgents()` signature to `listAgents(agentsDir?: string)` — defaults to `join(homedir(), ".claude", "agents")`.
3. Change `agentExists(name)` signature to `agentExists(name: string, agentsDir?: string)` — passes through to `listAgents`.
4. Change `readAgentContent(name)` signature to `readAgentContent(name: string, agentsDir?: string)` — passes through to `listAgents` and uses the `agentsDir` for file path construction.
5. Export `agentNameFromFile` — it's a pure function with real parsing logic that deserves direct testing.

**Verify:** After refactoring, run `bun test` and `bunx tsc --noEmit` to ensure all existing call sites (which pass no `agentsDir` argument) still work unchanged.

---

### Step 2: Write Unit Tests for `agents.ts`

**New file:** `src/agents.test.ts`

Using temp directories (the established pattern), test:

**`agentNameFromFile` (now exported):**
- `"typescript-craftsperson.agent.md"` → `"typescript-craftsperson"`
- `"my-agent.md"` → `"my-agent"`
- `"notes.txt"` → `null`
- `"readme"` → `null`
- `".agent.md"` → `""` (edge case: empty name with `.agent.md` suffix)

**`listAgents(agentsDir)`:**
- Given a temp dir with `foo.agent.md`, `bar.md`, `readme.txt` → returns `[{name:"bar", file:"bar.md"}, {name:"foo", file:"foo.agent.md"}]` (sorted, ignores non-`.md` files)
- Given an empty temp dir → returns `[]`
- Given a non-existent directory → returns `[]` (tests the catch branch)

**`agentExists(name, agentsDir)`:**
- Agent present → `true`
- Agent not present → `false`

**`readAgentContent(name, agentsDir)`:**
- Agent exists → returns file content string
- Agent not found → returns `null`
- Agent file exists but read fails (e.g., permissions) → returns `null` (tests the catch branch)

**Pattern:** Use `mkdtemp` + `try/finally` + `rm` for cleanup, exactly like existing tests.

---

### Step 3: Extract and Test Argument Parsing Logic from `commands/gates.ts`

**File:** `src/commands/gates.ts`

The agent-vs-folder detection heuristic (lines 11-25) is the most subtle logic in the command handlers. Extract it into a pure, exported function so it can be unit-tested directly.

**Extract:**

```typescript
export interface GatesArgs {
  agentName: string | undefined;
  folder: string;
}

export function parseGatesArgs(positional: string[]): GatesArgs {
  const hasAgent = positional.length >= 2 ||
    (positional.length === 1 && !positional[0]!.includes("/") && !positional[0]!.startsWith("."));

  if (positional.length >= 2) {
    return { agentName: positional[0], folder: resolve(positional[1]!) };
  } else if (hasAgent) {
    return { agentName: positional[0], folder: resolve(".") };
  } else {
    return { agentName: undefined, folder: resolve(positional[0] || ".") };
  }
}
```

Rewrite `gatesCommand` to call `parseGatesArgs(parsed.positional)` instead of inlining the heuristic.

**New file:** `src/commands/gates.test.ts`

**Unit tests for `parseGatesArgs`:**
- `["my-agent", "./project"]` → `{ agentName: "my-agent", folder: resolve("./project") }` (two positionals: agent + folder)
- `["my-agent"]` → `{ agentName: "my-agent", folder: resolve(".") }` (single word without `/` or `.` prefix: treated as agent)
- `["./src"]` → `{ agentName: undefined, folder: resolve("./src") }` (starts with `.`: treated as folder)
- `["src/app"]` → `{ agentName: undefined, folder: resolve("src/app") }` (contains `/`: treated as folder)
- `[]` → `{ agentName: undefined, folder: resolve(".") }` (no args: defaults to cwd)
- `["typescript-craftsperson", "/absolute/path"]` → `{ agentName: "typescript-craftsperson", folder: "/absolute/path" }` (absolute folder path)

**Integration tests** (subprocess style, same as `cli.test.ts`):
- `hone gates` with no args → prints "No quality gates found" (no `.hone-gates.json` in a temp dir)
- `hone gates <folder>` with a `.hone-gates.json` present → prints the gate list
- `hone gates --run <folder>` with a `.hone-gates.json` containing a simple passing gate (e.g., `"true"` command) → prints PASS results

---

### Step 4: Extract and Test Flag Override Logic from `commands/iterate.ts`

**File:** `src/commands/iterate.ts`

The flag override block (lines 30-41) mutates a config object based on parsed flags. Extract it into a pure function.

**Extract:**

```typescript
export function applyIterateFlags(config: HoneConfig, flags: Record<string, string | boolean>): HoneConfig {
  const result = { ...config, models: { ...config.models } };
  if (typeof flags["max-retries"] === "string") {
    result.maxRetries = parseInt(flags["max-retries"], 10);
  }
  if (typeof flags["assess-model"] === "string") {
    result.models.assess = flags["assess-model"];
  }
  if (typeof flags["plan-model"] === "string") {
    result.models.plan = flags["plan-model"];
  }
  if (typeof flags["execute-model"] === "string") {
    result.models.execute = flags["execute-model"];
  }
  return result;
}
```

Rewrite `iterateCommand` to call `applyIterateFlags(config, parsed.flags)` instead of mutating inline.

**New file:** `src/commands/iterate.test.ts`

**Unit tests for `applyIterateFlags`:**
- No flags → config unchanged (returns equivalent to input)
- `{ "max-retries": "5" }` → `config.maxRetries === 5`
- `{ "assess-model": "sonnet" }` → `config.models.assess === "sonnet"`, other models unchanged
- `{ "plan-model": "haiku", "execute-model": "opus" }` → both overridden
- All flags at once → all applied correctly
- `{ "max-retries": "abc" }` → `NaN` (documents current behavior — parseInt of non-numeric string)
- Boolean flag `{ "max-retries": true }` → config unchanged (typeof check rejects booleans)

**Integration tests** (subprocess style):
- `hone iterate` with no args → exit code 1, stderr contains "Usage:"
- `hone iterate nonexistent-agent ./src` → exit code 1, stderr contains "not found"

---

### Step 5: Write Integration Tests for `commands/derive.ts`

**New file:** `src/commands/derive.test.ts`

Since `deriveCommand` calls `derive()` which requires a `ClaudeInvoker`, and there's no practical way to unit-test this without module-level mocking, use subprocess integration tests:

**Integration tests:**
- `hone derive` with no args → exit code 1, stderr contains "Usage: hone derive"
- `hone derive <existing-folder>` → verify it attempts to run (will fail without Claude CLI available, but we can verify it gets past argument validation)

These tests verify the argument validation and error messaging paths that don't require external dependencies.

---

### Step 6: Write Integration Tests for `commands/list-agents.ts`

**New file:** `src/commands/list-agents.test.ts`

**Integration tests:**
- `hone list-agents` → exit code 0, stdout contains either agent names or "No agents found" (depends on whether `~/.claude/agents/` exists on the test machine, but either output is valid and verifiable)

---

### Step 7: Write Integration Tests for `commands/history.ts`

**New file:** `src/commands/history.test.ts`

**Integration tests:**
- `hone history <empty-temp-dir>` → exit code 0, stdout contains "No iteration history found"
- `hone history <dir-with-audit-folder>` → exit code 0, stdout contains "Iteration history" (set up a temp dir with an `audit/` subfolder containing a properly named subdirectory with a `.md` file)

---

### Step 8: Write Integration Tests for `commands/config.ts`

**New file:** `src/commands/config.test.ts`

**Integration tests:**
- `hone config` → exit code 0, stdout contains "Current configuration"
- `hone config` → stdout contains expected default model names (`opus`, `haiku`, `sonnet`)
- `hone config` → stdout contains "Config file:"

---

### Step 9: Run Full Quality Gate Verification

After all tests are written and passing:

1. `bun test` — all tests pass (existing 72 + new tests)
2. `bunx tsc --noEmit` — zero TypeScript errors
3. `bun build src/cli.ts --compile --outfile=build/hone` — binary compiles
4. `./build/hone --version` — binary runs

---

### Summary of Changes

| File | Action |
|------|--------|
| `src/agents.ts` | Add optional `agentsDir` parameter to all exported functions; export `agentNameFromFile` |
| `src/agents.test.ts` | **New** — unit tests for all agents functions |
| `src/commands/gates.ts` | Extract `parseGatesArgs` pure function |
| `src/commands/gates.test.ts` | **New** — unit tests for `parseGatesArgs` + integration tests |
| `src/commands/iterate.ts` | Extract `applyIterateFlags` pure function |
| `src/commands/iterate.test.ts` | **New** — unit tests for `applyIterateFlags` + integration tests |
| `src/commands/derive.test.ts` | **New** — integration tests for argument validation |
| `src/commands/list-agents.test.ts` | **New** — integration tests |
| `src/commands/history.test.ts` | **New** — integration tests |
| `src/commands/config.test.ts` | **New** — integration tests |

**Estimated new test count:** ~35-40 tests covering the 7 previously untested modules.

**Design principle:** Extract testable logic (pure functions) from imperative shell handlers, test the pure functions with unit tests, and test the wiring/integration with subprocess-level tests. This follows the functional core / imperative shell pattern already established in the codebase.