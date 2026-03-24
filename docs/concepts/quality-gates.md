# Quality Gates

Quality gates are the independent verification layer that separates hone from a bare LLM interaction. After the agent makes changes, hone runs your project's test suite, linter, type checker, and security scanner itself. The agent never self-certifies — hone checks the exit codes.

## Gate file format

Gates are defined in `.hone-gates.json` at your project root:

```json
{
  "gates": [
    { "name": "test", "command": "bun test", "required": true },
    { "name": "typecheck", "command": "bunx tsc --noEmit", "required": true },
    { "name": "lint", "command": "bunx biome check src", "required": true },
    { "name": "security", "command": "npm audit --audit-level=moderate", "required": false }
  ]
}
```

Each gate has these fields:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | — | Display name for progress output |
| `command` | string | — | Shell command to run (via `sh -c`) |
| `required` | boolean | `true` | Whether failure triggers the retry loop |
| `timeout` | number (ms) | — | Per-gate timeout override (falls back to global `gateTimeout`) |

## Required vs optional gates

**Required gates** (`required: true`) are enforced. If any required gate fails after execution, hone sends the agent back with the failure output to fix it. This retry loop continues up to `--max-retries` times (default: 3).

**Optional gates** (`required: false`) are reported but don't block. If a security audit finds a moderate vulnerability in a transitive dependency, you probably don't want the agent trying to fix it — but you do want to see it in the output.

## Gate resolution

When hone needs gates, it checks three sources in priority order:

1. **`.hone-gates.json`** in the project root — highest priority, no LLM call needed
2. **Agent extraction** — hone reads the agent's QA checkpoints and uses Claude to extract gate commands
3. **Empty** — no gates found, verification is skipped entirely

The recommended workflow is to always have a `.hone-gates.json` file. This avoids an extra Claude call on every run and gives you version-controlled gate definitions.

## Creating a gates file

Three ways to get a `.hone-gates.json`:

### With `hone derive`

Derive generates both an agent and a gates file in one step:

```bash
hone derive /path/to/project
```

### With `hone derive-gates`

If you already have an agent and just need gates:

```bash
hone derive-gates /path/to/project                        # inspect project tooling
hone derive-gates <agent-name> /path/to/project            # also use agent as context
hone derive-gates /path/to/project --run                   # generate and run immediately
```

### With `hone gates --save`

Extract gates from an existing agent's QA checkpoints:

```bash
hone gates <agent-name> /path/to/project --save
```

## Preflight

Before any LLM work, hone runs all gates against the **unmodified codebase**. This catches problems that exist before hone touches anything:

- Missing tools (e.g. `tsc` not installed)
- Pre-existing test failures
- Broken lint configuration

If preflight fails, hone stops immediately. There's no point sending an agent to fix code when the quality gates themselves are broken. Fix the gates first, then iterate.

Skip preflight with `--skip-gates`.

## Re-read during retries

During the verify loop, hone re-reads `.hone-gates.json` before each attempt. This means the agent can update gate definitions during execution if needed — for example, adding a gate for a new tool it introduced. The updated gates are picked up on the next verify pass.

## Gate execution details

Gates run sequentially as shell commands via `sh -c`. Output (stdout and stderr combined) is captured and truncated to the last 200 lines if it's longer. A gate passes when its command exits with code 0.

The gate timeout defaults to 120 seconds (configurable via `gateTimeout` in [config](/reference/configuration)). Individual gates can override this with a `timeout` field in milliseconds. If a command exceeds its timeout, the process is killed and the gate is marked as failed.

For projects with gates that vary widely in execution time — for example, a fast linter alongside a slow build-and-test pipeline — per-gate timeouts let you keep the global default tight while giving specific gates more room:

```json
{
  "gates": [
    {
      "name": "coverage",
      "command": "cmake -B build && cmake --build build && cmake --build build --target coverage",
      "required": true,
      "timeout": 300000
    },
    { "name": "cppcheck", "command": "cmake --build build --target cppcheck", "required": true }
  ]
}
```

Here, the coverage gate gets 5 minutes while cppcheck uses the global `gateTimeout` (default 120s).
