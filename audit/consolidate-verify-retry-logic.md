```json
{ "severity": 3, "principle": "No Knowledge Duplication", "category": "architecture" }
```

## Assessment

The most violated principle in this codebase is **No Knowledge Duplication** — specifically, the verify-and-retry loop logic is duplicated between `iterate.ts` (`runExecuteWithVerify`) and `maintain.ts`.

### Where the duplication lives

Compare `maintain.ts` lines 172–214 with `iterate.ts`'s `runExecuteWithVerify` function (lines 186–283). Both implement the **same inner enforcement loop**:

1. Run quality gates after execution
2. Check if required gates passed → break
3. Check if max retries exhausted → break
4. Collect failed gate output
5. Build a retry prompt with prior attempt history
6. Invoke Claude with the retry prompt
7. Save retry audit artifacts (`retry-N-actions.md`)
8. Loop

The structural shape is identical. The only differences are:

- **The initial prompt** (dependency update vs. plan execution) — this is the *execution* step that precedes the loop, not the loop itself.
- **The retry prompt builder** (`buildMaintainRetryPrompt` vs `buildRetryPrompt`) — these differ only in the "Goal" section and the final instruction sentence ("without reverting the dependency updates" vs "WITHOUT regressing on the original improvement").
- **The `AttemptRecord` type** is independently defined in both files with the same shape.

Everything else — the loop mechanics, gate re-reading (`loadOverrideGates`), progress reporting, audit file saving, attempt tracking, retry count management — is structurally identical code representing the **same decision**: "how hone enforces quality gates after an agent makes changes."

### Why this matters (severity: 3)

This is a moderate concern, not critical, because:

- **It's working correctly today** — both loops behave as documented.
- **It creates real maintenance risk** — any change to the retry strategy (e.g., adding exponential backoff, changing truncation, adding a new progress event, changing how `.hone-gates.json` is re-read) must be applied to **both files** or they'll diverge silently.
- **The `AttemptRecord` type** being independently defined in both files is a classic duplication signal — it represents the same concept.

### How to correct it

**Extract a shared `verifyWithRetry` function** that encapsulates the inner enforcement loop. The function would accept:

- A gate runner and gate definitions
- Config (maxRetries, gateTimeout)
- An audit dir and name (for saving retry artifacts)
- A progress callback
- A **retry prompt builder** function (the only thing that actually differs between iterate and maintain)

The signature would look something like:

```typescript
interface VerifyWithRetryOpts {
  gates: GateDefinition[];
  gateRunner: GateRunner;
  config: Pick<HoneConfig, 'maxRetries' | 'gateTimeout' | 'models'>;
  auditDir: string;
  name: string;
  folder: string;
  claude: ClaudeInvoker;
  agent: string;
  readOnlyTools: string;
  buildRetryPrompt: (failedGates: FailedGate[], priorAttempts: AttemptRecord[]) => string;
  onProgress: (stage: string, message: string) => void;
}

async function verifyWithRetry(opts: VerifyWithRetryOpts): Promise<{
  gatesResult: GatesRunResult | null;
  retries: number;
  execution: string;
}>
```

Then `runExecuteWithVerify` in `iterate.ts` and the verify section of `maintain.ts` would both delegate to this shared function, passing their own retry prompt builder as a parameter.

The `AttemptRecord` type would move to `types.ts` as a single definition.

This change would:
- Eliminate ~40 lines of duplicated loop logic
- Create a single place to evolve the retry strategy
- Keep the **intentional differences** (prompt wording) explicit via the callback parameter
- Not add premature abstraction — the pattern has already emerged twice and represents the same architectural decision