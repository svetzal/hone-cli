Now I have a complete understanding. Here is the plan:

---

## Plan: Eliminate Knowledge Duplication in Test Mock Infrastructure

### Problem Summary

The `iterate.test.ts` file contains 7 mock `ClaudeInvoker` implementations that each independently:
1. Extract the prompt from the `args` array by searching for the `-p` flag index
2. Dispatch to a stage-specific response by inspecting prompt prefixes (`"Assess"`, `"Output ONLY"`, `"Based on"`, `"Execute"`, `"The previous execution"`)

This is duplicated knowledge — the same prompt-extraction logic and the same prefix-to-stage mapping are repeated in every mock. If any prompt wording changes in `iterate.ts`, all 7 mocks must be updated in lockstep. The `derive.test.ts` file has 2 additional mocks with a similar (but different) dispatch pattern based on `prompt.includes()`.

### Approach: Extract a shared `createStageMock` test helper

We will consolidate the duplicated dispatch logic into a single shared helper in a new test utility file `src/test-helpers.ts`. This file contains:
1. A function to extract the prompt from a Claude args array (the `-p` flag lookup)
2. A `createIterateMock` factory for `iterate.test.ts` that accepts per-stage response strings
3. A `createDeriveMock` factory for `derive.test.ts` that accepts per-call response strings

The `extract-gates.test.ts` and `resolve-gates.test.ts` mocks do **not** use prompt-sniffing dispatch — they return a single unconditional response per mock (or throw). These are already minimal and don't need consolidation.

### Step-by-Step Plan

#### Step 1: Create `src/test-helpers.ts` with shared mock factories

Create a new file `src/test-helpers.ts` containing:

```typescript
import type { ClaudeInvoker } from "./types.ts";

/**
 * Extract the prompt string from a Claude CLI args array.
 * Single source of truth for how prompts are encoded in args.
 */
export function extractPrompt(args: string[]): string {
  const idx = args.indexOf("-p");
  return idx >= 0 ? args[idx + 1] ?? "" : "";
}

/**
 * Stage responses for the iterate workflow mock.
 * Maps each stage to the string the mock should return.
 */
export interface IterateStageResponses {
  assess: string;
  name: string;
  plan: string;
  execute: string;
}

/**
 * Creates a mock ClaudeInvoker that dispatches based on iterate stage prompts.
 * Consolidates the prompt-prefix dispatch logic into one place.
 *
 * Options:
 * - `onCall`: optional callback invoked with each call's args (for assertions)
 */
export function createIterateMock(
  responses: IterateStageResponses,
  opts?: { onCall?: (args: string[]) => void },
): ClaudeInvoker {
  return async (args) => {
    opts?.onCall?.(args);
    const prompt = extractPrompt(args);

    if (prompt.startsWith("Assess")) return responses.assess;
    if (prompt.startsWith("Output ONLY")) return responses.name;
    if (prompt.startsWith("Based on")) return responses.plan;
    if (prompt.startsWith("Execute") || prompt.startsWith("The previous execution")) {
      return responses.execute;
    }
    return "";
  };
}

/**
 * Creates a mock ClaudeInvoker for the derive workflow.
 * The derive workflow makes 2 calls: derive (project inspection) and gate extraction.
 */
export function createDeriveMock(
  responses: { derive: string; gateExtraction: string },
  opts?: { onCall?: (args: string[]) => void },
): ClaudeInvoker {
  return async (args) => {
    opts?.onCall?.(args);
    const prompt = extractPrompt(args);

    if (prompt.includes("inspecting a software project")) {
      return responses.derive;
    }
    // Gate extraction call
    return responses.gateExtraction;
  };
}
```

**Key design decisions:**
- `extractPrompt` is the single place that knows how to find `-p` in an args array
- `createIterateMock` is the single place that knows which prompt prefix maps to which stage
- The retry prompt (`"The previous execution"`) is handled alongside `"Execute"` since they're the same stage (execute), just a retry — this matches the existing behavior in 3 of the 7 mocks
- The `onCall` callback replaces the `calls.push(args)` pattern, letting tests collect args when they need to assert on them
- `createDeriveMock` covers the derive-specific dispatch (uses `includes` rather than `startsWith`)

#### Step 2: Write tests for the test helpers themselves

Add a file `src/test-helpers.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { extractPrompt, createIterateMock, createDeriveMock } from "./test-helpers.ts";

describe("extractPrompt", () => {
  test("extracts prompt after -p flag", () => {
    expect(extractPrompt(["--model", "opus", "-p", "hello world"])).toBe("hello world");
  });

  test("returns empty string when -p is absent", () => {
    expect(extractPrompt(["--model", "opus"])).toBe("");
  });

  test("returns empty string when -p is last element", () => {
    expect(extractPrompt(["--model", "opus", "-p"])).toBe("");
  });
});

describe("createIterateMock", () => {
  test("dispatches assess stage", async () => {
    const mock = createIterateMock({
      assess: "assessment result",
      name: "name result",
      plan: "plan result",
      execute: "execute result",
    });
    const result = await mock(["--model", "opus", "-p", "Assess the project..."]);
    expect(result).toBe("assessment result");
  });

  test("dispatches name stage", async () => {
    const mock = createIterateMock({
      assess: "a", name: "name result", plan: "p", execute: "e",
    });
    const result = await mock(["-p", "Output ONLY a short kebab-case..."]);
    expect(result).toBe("name result");
  });

  test("dispatches plan stage", async () => {
    const mock = createIterateMock({
      assess: "a", name: "n", plan: "plan result", execute: "e",
    });
    const result = await mock(["-p", "Based on the following assessment..."]);
    expect(result).toBe("plan result");
  });

  test("dispatches execute stage", async () => {
    const mock = createIterateMock({
      assess: "a", name: "n", plan: "p", execute: "execute result",
    });
    const result = await mock(["-p", "Execute the following plan..."]);
    expect(result).toBe("execute result");
  });

  test("dispatches retry as execute stage", async () => {
    const mock = createIterateMock({
      assess: "a", name: "n", plan: "p", execute: "retry result",
    });
    const result = await mock(["-p", "The previous execution introduced..."]);
    expect(result).toBe("retry result");
  });

  test("calls onCall callback with args", async () => {
    const calls: string[][] = [];
    const mock = createIterateMock(
      { assess: "a", name: "n", plan: "p", execute: "e" },
      { onCall: (args) => calls.push(args) },
    );
    await mock(["-p", "Assess..."]);
    expect(calls.length).toBe(1);
  });
});

describe("createDeriveMock", () => {
  test("dispatches derive call", async () => {
    const mock = createDeriveMock({
      derive: "agent content",
      gateExtraction: "[]",
    });
    const result = await mock(["-p", "You are inspecting a software project..."]);
    expect(result).toBe("agent content");
  });

  test("dispatches gate extraction call", async () => {
    const mock = createDeriveMock({
      derive: "agent content",
      gateExtraction: '[{"name":"test","command":"bun test","required":true}]',
    });
    const result = await mock(["-p", "Extract gates from..."]);
    expect(result).toBe('[{"name":"test","command":"bun test","required":true}]');
  });
});
```

Run tests to verify: `bun test src/test-helpers.test.ts`

#### Step 3: Refactor `iterate.test.ts` to use `createIterateMock`

Replace each of the 7 inline mock definitions with calls to `createIterateMock`.

**Test 1: "runs full cycle with mock claude invoker" (lines 18–84)**

Before:
```typescript
const calls: string[][] = [];
const mockClaude: ClaudeInvoker = async (args) => {
  calls.push(args);
  const promptIdx = args.indexOf("-p");
  const prompt = promptIdx >= 0 ? args[promptIdx + 1]! : "";
  if (prompt.startsWith("Assess")) return "The project violates...";
  if (prompt.startsWith("Output ONLY")) return "fix-srp-violation";
  if (prompt.startsWith("Based on")) return "Step 1: Extract class\nStep 2: Move methods";
  if (prompt.startsWith("Execute")) return "Extracted UserAuth class into its own module.";
  return "unknown stage";
};
```

After:
```typescript
const calls: string[][] = [];
const mockClaude = createIterateMock(
  {
    assess: "The project violates the single responsibility principle.",
    name: "fix-srp-violation",
    plan: "Step 1: Extract class\nStep 2: Move methods",
    execute: "Extracted UserAuth class into its own module.",
  },
  { onCall: (args) => calls.push(args) },
);
```

**Test 2: "falls back to timestamp name when sanitization fails" (lines 86–117)**

After:
```typescript
const mockClaude = createIterateMock({
  assess: "assessment",
  name: "!!!INVALID!!!",
  plan: "plan",
  execute: "done",
});
```

**Test 3: "gates pass on first attempt" (lines 119–183)**

After:
```typescript
const claudeCalls: string[][] = [];
const mockClaude = createIterateMock(
  {
    assess: "Assessment content",
    name: "test-issue-name",
    plan: "Plan content",
    execute: "Execution content",
  },
  { onCall: (args) => claudeCalls.push(args) },
);
```

**Test 4: "required gate fails, retry succeeds" (lines 185–269)**

After:
```typescript
const claudeCalls: string[][] = [];
const mockClaude = createIterateMock(
  {
    assess: "Assessment content",
    name: "test-issue-name",
    plan: "Plan content",
    execute: "Execution content",
  },
  { onCall: (args) => claudeCalls.push(args) },
);
```

**Test 5: "required gate fails, max retries exhausted" (lines 271–337)**

After:
```typescript
const claudeCalls: string[][] = [];
const mockClaude = createIterateMock(
  {
    assess: "Assessment content",
    name: "test-issue-name",
    plan: "Plan content",
    execute: "Execution content",
  },
  { onCall: (args) => claudeCalls.push(args) },
);
```

**Test 6: "optional gate fails — no retry triggered" (lines 339–396)**

After:
```typescript
const claudeCalls: string[][] = [];
const mockClaude = createIterateMock(
  {
    assess: "Assessment content",
    name: "test-issue-name",
    plan: "Plan content",
    execute: "Execution content",
  },
  { onCall: (args) => claudeCalls.push(args) },
);
```

**Test 7: "retry prompt contains original plan and failure output" (lines 398–473)**

After:
```typescript
const claudeCalls: string[][] = [];
const mockClaude = createIterateMock(
  {
    assess: "Assessment content",
    name: "test-issue-name",
    plan: "Plan with specific steps",
    execute: "Execution content",
  },
  { onCall: (args) => claudeCalls.push(args) },
);
```

Also update the import at the top to add `createIterateMock` and `extractPrompt` from `./test-helpers.ts`, and remove the `ClaudeInvoker` type import if it's no longer directly used.

The assertions that inspect the retry prompt (in test 7, around line 459) use `extractPrompt` from the helper instead of re-deriving the index:

```typescript
// Before:
const retryCall = claudeCalls[4]!;
const promptIdx = retryCall.indexOf("-p");
const retryPrompt = retryCall[promptIdx + 1]!;

// After:
const retryPrompt = extractPrompt(claudeCalls[4]!);
```

#### Step 4: Refactor `derive.test.ts` to use `createDeriveMock`

**Test 1: "calls Claude with project context and returns result" (lines 121–163)**

Before:
```typescript
let callCount = 0;
const mockClaude: ClaudeInvoker = async (args) => {
  callCount++;
  const promptIdx = args.indexOf("-p");
  const prompt = promptIdx >= 0 ? args[promptIdx + 1]! : "";
  if (prompt.includes("inspecting a software project")) {
    return `---\nname: test-craftsperson\n...`;
  }
  return JSON.stringify([{ name: "test", command: "bun test", required: true }]);
};
```

After:
```typescript
let callCount = 0;
const mockClaude = createDeriveMock(
  {
    derive: `---\nname: test-craftsperson\ndescription: Test agent\n---\n\n# Test Craftsperson\n\n## QA Checkpoints\n- Run \`bun test\``,
    gateExtraction: JSON.stringify([
      { name: "test", command: "bun test", required: true },
    ]),
  },
  { onCall: () => { callCount++; } },
);
```

**Test 2: "prompt includes project context" (lines 165–192)**

Before:
```typescript
let capturedPrompt = "";
const mockClaude: ClaudeInvoker = async (args) => {
  const promptIdx = args.indexOf("-p");
  const prompt = promptIdx >= 0 ? args[promptIdx + 1]! : "";
  if (prompt.includes("inspecting a software project")) {
    capturedPrompt = prompt;
    return "---\nname: test\n---\n# Test";
  }
  return "[]";
};
```

After:
```typescript
let capturedPrompt = "";
const mockClaude = createDeriveMock(
  {
    derive: "---\nname: test\n---\n# Test",
    gateExtraction: "[]",
  },
  {
    onCall: (args) => {
      const prompt = extractPrompt(args);
      if (prompt.includes("inspecting a software project")) {
        capturedPrompt = prompt;
      }
    },
  },
);
```

Update imports at the top: add `import { createDeriveMock, extractPrompt } from "./test-helpers.ts";` and remove the `ClaudeInvoker` type import if no longer needed.

#### Step 5: Run all tests and verify nothing broke

```bash
bun test
```

All 132+ tests must pass. The behavior of every test is unchanged — we only consolidated the mock dispatch logic, not the test assertions.

#### Step 6: Run full quality gate checks

```bash
bunx tsc --noEmit    # Type check
```

Ensure zero errors.

### What This Achieves

**Before:** 9 copies of the prompt-extraction and dispatch logic across `iterate.test.ts` and `derive.test.ts`. If a prompt prefix changes (e.g., `"Assess the project"` → `"Evaluate the project"`), you must update 7+ locations.

**After:** The prompt-extraction logic lives in `extractPrompt()` (1 place). The iterate stage dispatch lives in `createIterateMock()` (1 place). The derive stage dispatch lives in `createDeriveMock()` (1 place). If prompt wording changes, you fix exactly 1 function.

**What we don't touch:**
- `extract-gates.test.ts` — its mocks are simple single-response lambdas, not prompt-dispatching. No duplication to consolidate.
- `resolve-gates.test.ts` — same: single-response or throw mocks. No duplication.
- Production code — `ClaudeInvoker` type, `iterate.ts`, `derive.ts` all remain unchanged. This is purely a test infrastructure improvement.

### Risk Assessment

**Low risk.** Every test assertion remains identical. We're only changing how mock responses are defined, not what they return. The test helper itself is tested. The refactoring is purely mechanical — moving inline closures into a shared factory with the same logic.