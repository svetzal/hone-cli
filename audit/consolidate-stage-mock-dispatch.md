Good — all gates pass. Now I have a comprehensive view of the entire codebase. Let me deliver my assessment.

---

## Assessment: hone-cli against TypeScript Craftsperson Principles

### Overall Impression

This is a remarkably well-structured project. The architecture is clean, module boundaries are well-chosen, dependency injection enables thorough testing, and every source module has a colocated test file. The functional core / imperative shell separation is evident — pure logic in `iterate.ts`, `sanitizeName`, `buildRetryPrompt` are all easily testable, and side effects (Claude subprocess calls, file I/O) are pushed to injectable boundaries. 132 tests pass. Types are strict. Zero `any` usage. No external runtime dependencies. This is strong work.

### Principle Most Violated: **No Knowledge Duplication**

The codebase's most significant violation is **knowledge duplication** — specifically, the repeated pattern of extracting prompts from Claude invocation args inside test mocks. This isn't copy-paste of identical code (which would be fine if representing independent decisions), but rather **the same knowledge expressed in two places that must change together**.

#### Where It Manifests

**1. Every test mock couples to prompt string prefixes as a dispatch mechanism**

Across `iterate.test.ts` and `derive.test.ts`, every mock `ClaudeInvoker` uses the same fragile pattern to determine which "stage" a call represents:

```typescript
const mockClaude: ClaudeInvoker = async (args) => {
  const promptIdx = args.indexOf("-p");
  const prompt = promptIdx >= 0 ? args[promptIdx + 1]! : "";

  if (prompt.startsWith("Assess")) return "...";
  if (prompt.startsWith("Output ONLY")) return "...";
  if (prompt.startsWith("Based on")) return "...";
  if (prompt.startsWith("Execute")) return "...";
  return "";
};
```

This pattern is repeated **7 times** in `iterate.test.ts` alone. Each mock duplicates:
- The knowledge of how to extract a prompt from `args` (index-based lookup of `-p` flag)
- The knowledge of which string prefix corresponds to which stage
- The knowledge that the stage order is assess → name → plan → execute

If you change the assessment prompt from `"Assess the project..."` to `"Evaluate the project..."`, you must update all 7 mocks. The test is coupled to **implementation details** (prompt wording) rather than **behavior** (which stage is being invoked). This is exactly the kind of "multiple spots that must change together for the same reason" that the No Knowledge Duplication principle guards against.

**2. The dispatch knowledge is already implicit in `iterate.ts` but not extractable**

The `iterate()` function calls Claude sequentially for each stage. The production code knows the stage order. The test mocks re-derive this knowledge by inspecting prompt strings — a lossy, fragile proxy for "which stage am I in?"

#### How to Correct It

The core issue is that `ClaudeInvoker` is a single opaque function `(args: string[]) => Promise<string>`. Tests have no structured way to know which stage they're responding to, so they resort to prompt-sniffing.

**Approach: Make the stage identity explicit at the boundary.**

1. **Introduce a stage-aware invoker interface** — Instead of tests parsing raw args, the `iterate()` function could pass stage metadata alongside each invocation. For example, change the internal call pattern so tests can dispatch on stage identity rather than prompt content:

```typescript
// A factory that creates a mock responding to call order
function createSequentialMock(responses: string[]): ClaudeInvoker {
  let callIndex = 0;
  return async (_args) => {
    const response = responses[callIndex] ?? "";
    callIndex++;
    return response;
  };
}
```

Or, more expressively, extract the prompt-arg-extraction into a single shared test utility:

```typescript
// test-helpers.ts — single place for this knowledge
function extractPrompt(args: string[]): string {
  const idx = args.indexOf("-p");
  return idx >= 0 ? args[idx + 1] ?? "" : "";
}

type StageMock = {
  assess: string;
  name: string;
  plan: string;
  execute: string;
};

function createStageMock(responses: StageMock): ClaudeInvoker {
  return async (args) => {
    const prompt = extractPrompt(args);
    if (prompt.startsWith("Assess")) return responses.assess;
    if (prompt.startsWith("Output ONLY")) return responses.name;
    if (prompt.startsWith("Based on")) return responses.plan;
    if (prompt.startsWith("Execute") || prompt.startsWith("The previous execution")) return responses.execute;
    return "";
  };
}
```

This consolidates the duplicated dispatch logic into **one place**. If prompt wording changes, you fix it in one spot. Tests become declarations of expected responses per stage rather than re-implementations of the routing logic.

2. **For the most thorough fix**: Consider whether `iterate()` should accept a more structured interface than raw `ClaudeInvoker`, something like:

```typescript
interface StageInvoker {
  invokeStage(stage: "assess" | "name" | "plan" | "execute", args: string[]): Promise<string>;
}
```

This makes the stage identity a first-class concept at the boundary, eliminating prompt-sniffing entirely. Tests mock at the semantic level ("when assess is called, return X") rather than the transport level ("when args contain a string starting with 'Assess', return X").

### Secondary Observations (lower priority)

- **`resolve-gates.ts` line 12**: `config.gates as GateDefinition[]` uses a type assertion without runtime validation. This is a boundary (file I/O) where Zod or manual validation would be appropriate.
- **`derive.ts` line 83**: The `listDirectoryTree` filter chain is a long single-line expression that would benefit from extraction into a named predicate like `isRelevantEntry()`.
- **`cli.ts`**: `parseArgs` is not exported, so it can only be tested via subprocess integration tests. Exporting it (or extracting to its own module) would enable fast unit tests.

But these are minor compared to the knowledge duplication in the test infrastructure, which is the single most impactful improvement available.