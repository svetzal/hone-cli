Now I have a complete understanding of the codebase. Here is the step-by-step execution plan:

---

## Execution Plan: Add `--json` Output to All hone-cli Commands

### Background

The hone-cli assessment identified **Composability (Unix Philosophy)** as the most violated CONSTITUTION principle. The highest-impact correction is adding `--json` output to all 6 commands, enabling composition with `jq`, the MojilityNG event system, and other ecosystem tools.

### Design Principles

- **`--json` flag** causes structured JSON to be emitted to **stdout**
- **Progress/status messages** go to **stderr** when `--json` is active (Unix convention: data on stdout, diagnostics on stderr)
- **Exit codes** remain unchanged (0 = success, 1 = failure)
- **Human-readable output** remains the default (no `--json` = current behavior)
- **No new dependencies** — uses `JSON.stringify` directly

### Helper: Output Utility

Create a small output helper to standardize the pattern across commands, avoiding duplication.

---

### Step 1: Add `output.ts` — Shared Output Utilities

**File:** `src/output.ts`

Create a utility module with two functions:

```typescript
export function writeJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function progress(json: boolean, message: string): void {
  if (!json) {
    console.log(message);
  } else {
    console.error(message);
  }
}
```

- `writeJson` serializes and prints to stdout
- `progress` routes human-readable messages to stdout (normal mode) or stderr (`--json` mode)

Add a test file `src/output.test.ts` verifying both functions redirect output correctly.

---

### Step 2: Update `cli.ts` — Document `--json` in Help Text

**File:** `src/cli.ts`

In the `printHelp()` function, add `--json` under **General Options**:

```
General Options:
  --json                     Output machine-readable JSON to stdout
  --help                     Show this help message
  --version                  Show version number
```

No changes needed to `parseArgs()` — the `--json` boolean flag is already handled generically (any `--foo` without a value becomes `flags["json"] = true`).

---

### Step 3: Update `commands/config.ts` — JSON Config Output

**File:** `src/commands/config.ts`

Changes:
1. Check `parsed.flags.json === true`
2. If `--json`: emit the `HoneConfig` object as JSON via `writeJson(config)`
3. If not: retain current human-readable output (no changes)

**JSON output shape:**
```json
{
  "models": {
    "assess": "opus",
    "name": "haiku",
    "plan": "opus",
    "execute": "sonnet",
    "gates": "haiku",
    "derive": "opus"
  },
  "auditDir": "audit",
  "readOnlyTools": "Read Glob Grep WebFetch WebSearch",
  "maxRetries": 3,
  "gateTimeout": 120000
}
```

**Tests to add in `commands/config.test.ts`:**
- Integration test: run `hone config --json`, parse stdout as JSON, verify it matches expected structure

---

### Step 4: Update `commands/list-agents.ts` — JSON Agent List

**File:** `src/commands/list-agents.ts`

Changes:
1. Check `parsed.flags.json === true`
2. If `--json`: emit the agents array as JSON via `writeJson(agents)` (each element: `{ name: string, file: string }`)
3. If not: retain current human-readable output

**JSON output shape:**
```json
[
  { "name": "typescript-craftsperson", "file": "/path/to/file.agent.md" }
]
```

**Tests to add in `commands/list-agents.test.ts`:**
- Integration test: run `hone list-agents --json`, parse stdout, verify it's an array of `{ name, file }`

---

### Step 5: Update `commands/history.ts` — JSON History Output

**File:** `src/commands/history.ts`

Changes:
1. Check `parsed.flags.json === true`
2. If `--json`: emit the iterations array as JSON. Convert `Date` objects to ISO strings for serialization.
3. If not: retain current human-readable output

**JSON output shape:**
```json
[
  {
    "name": "fix-srp-violation",
    "files": ["fix-srp-violation.md", "fix-srp-violation-plan.md", "fix-srp-violation-actions.md"],
    "date": "2025-01-15T19:30:00.000Z"
  }
]
```

**Tests to add in `commands/history.test.ts`:**
- Integration test: create temp dir with mock audit files, run `hone history <dir> --json`, parse stdout as JSON array, verify entries have `name`, `files`, `date` fields

---

### Step 6: Update `commands/gates.ts` — JSON Gates Output

**File:** `src/commands/gates.ts`

This command has three modes that all need JSON handling:

**Mode 1: List gates (no `--run`):**
- If `--json`: emit the resolved `GateDefinition[]` array as JSON
- Shape: `[{ "name": "test", "command": "bun test", "required": true }]`

**Mode 2: Run gates (`--run`):**
- If `--json`: emit the `GatesRunResult` object as JSON
- Shape: `{ "allPassed": true, "requiredPassed": true, "results": [{ "name": "test", "command": "bun test", "passed": true, "required": true, "output": "...", "exitCode": 0 }] }`
- Route "Running quality gates..." progress message to stderr

**Mode 3: No gates found:**
- If `--json`: emit empty array `[]` (or `{ "gates": [], "message": "..." }`)

**The `--save` flag** works independently of `--json` (it writes to a file, not stdout). No change needed for `--save`.

**Tests to add in `commands/gates.test.ts`:**
- Integration test: list gates with `--json`, verify JSON array of gate definitions
- Integration test: run gates with `--run --json`, verify JSON `GatesRunResult` structure
- Integration test: no gates with `--json`, verify empty array

---

### Step 7: Update `commands/iterate.ts` — JSON Iteration Output

**File:** `src/commands/iterate.ts`

This is the most important command for JSON output. Changes:

1. Check `parsed.flags.json === true`
2. If `--json`: 
   - Pass `json: true` context to the `onProgress` callback so progress goes to stderr
   - After `iterate()` returns the `IterationResult`, emit it as JSON via `writeJson(result)`
   - Then check `result.success` for exit code as before
3. If not: retain current progress-to-stdout behavior

**JSON output shape** (the existing `IterationResult` type, serialized):
```json
{
  "name": "fix-srp-violation",
  "assessment": "The project violates...",
  "plan": "Step 1: ...",
  "execution": "Changed files...",
  "gatesResult": {
    "allPassed": true,
    "requiredPassed": true,
    "results": [
      { "name": "test", "command": "bun test", "passed": true, "required": true, "output": "...", "exitCode": 0 }
    ]
  },
  "retries": 1,
  "success": true
}
```

The `onProgress` callback change:
```typescript
onProgress: (stage, message) => {
  if (jsonFlag) {
    console.error(`==> [${stage}] ${message}`);
  } else {
    console.log(`==> [${stage}] ${message}`);
  }
},
```

**Tests to add in `commands/iterate.test.ts`:**
- Integration test: verify that `hone iterate nonexistent-agent . --json` still exits 1 with error on stderr (not stdout)

---

### Step 8: Update `commands/derive.ts` — JSON Derive Output

**File:** `src/commands/derive.ts`

Changes:
1. Check `parsed.flags.json === true`
2. If `--json`:
   - Route progress messages ("Inspecting project...") to stderr
   - After derive completes and files are written, emit a JSON summary to stdout
3. If not: retain current behavior

**JSON output shape:**
```json
{
  "agentName": "typescript-craftsperson",
  "agentPath": "/Users/foo/.claude/agents/typescript-craftsperson.agent.md",
  "gates": [
    { "name": "test", "command": "bun test", "required": true }
  ],
  "gatesPath": "/path/to/.hone-gates.json"
}
```

(`gatesPath` is `null` if no gates were extracted.)

**Tests to add in `commands/derive.test.ts`:**
- Skip if derive tests require Claude invocation (they do). Add a note in the test for future integration test.

---

### Step 9: Run Quality Gates

After all changes are made, run the full gate suite to verify nothing is broken:

```bash
cd /Users/svetzal/Work/MojilityNG/internal-projects/hone-cli
bunx tsc --noEmit       # Typecheck
bun test                # All tests (existing + new)
```

Fix any failures before proceeding.

---

### Step 10: Update Help/Docs

1. In `cli.ts`, ensure the `--json` flag is documented under each command's options section in the help text (it appears in General Options, which applies to all commands).
2. No README changes needed unless user requests it.

---

### Summary of Files to Create/Modify

| File | Action | What |
|------|--------|------|
| `src/output.ts` | **Create** | `writeJson()` and `progress()` helpers |
| `src/output.test.ts` | **Create** | Tests for output utilities |
| `src/cli.ts` | **Modify** | Add `--json` to help text |
| `src/commands/config.ts` | **Modify** | Add `--json` branch |
| `src/commands/list-agents.ts` | **Modify** | Add `--json` branch |
| `src/commands/history.ts` | **Modify** | Add `--json` branch |
| `src/commands/gates.ts` | **Modify** | Add `--json` branch for list, run, and empty modes |
| `src/commands/iterate.ts` | **Modify** | Add `--json` branch, redirect progress to stderr |
| `src/commands/derive.ts` | **Modify** | Add `--json` branch, redirect progress to stderr |
| `src/commands/config.test.ts` | **Create** | Integration test for `--json` |
| `src/commands/list-agents.test.ts` | **Create** | Integration test for `--json` |
| `src/commands/history.test.ts` | **Modify** | Add `--json` integration test |
| `src/commands/gates.test.ts` | **Modify** | Add `--json` integration tests |
| `src/commands/iterate.test.ts` | **Modify** | Add `--json` integration test |

---

### Execution Order

1. Create `output.ts` + `output.test.ts` (foundation)
2. Update `cli.ts` help text
3. Update the 4 simpler commands: `config`, `list-agents`, `history`, `gates`
4. Update the 2 complex commands: `iterate`, `derive`
5. Add/update tests for all commands
6. Run quality gates (`tsc --noEmit && bun test`)
7. Fix any failures
8. Commit and push