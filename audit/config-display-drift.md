Good — all 220 tests pass and TypeScript checks clean. Now I have a comprehensive understanding of the entire codebase. Let me formulate my assessment.

```json
{ "severity": 3, "principle": "No Knowledge Duplication", "category": "architecture" }
```

## Assessment: Knowledge Duplication in Config Handling and JSON/Text Output Patterns

### The Most Violated Principle

After a thorough review of the hone-cli codebase, I want to note that this is a well-structured, well-tested project. The code is clean, functions are focused, types are solid, and the test coverage is comprehensive (220 tests across 23 files). That said, the principle most consistently violated is **No Knowledge Duplication** — specifically, the `config` command's display logic encodes knowledge about the `HoneConfig` structure that has drifted out of sync with the type, and the `--json` output branching pattern is repeated across every command handler with the same structural shape but no shared abstraction.

### Where the Duplication Lives

#### 1. Config Display vs. Config Structure (the primary violation)

In `src/commands/config.ts`, the human-readable output hardcodes which fields to show:

```typescript
console.log(`  Models:`);
console.log(`    assess:   ${config.models.assess}`);
console.log(`    name:     ${config.models.name}`);
console.log(`    plan:     ${config.models.plan}`);
console.log(`    execute:  ${config.models.execute}`);
console.log(`  Audit dir:      ${config.auditDir}`);
console.log(`  Read-only tools: ${config.readOnlyTools}`);
console.log(`  Max retries:    ${config.maxRetries}`);
console.log(`  Gate timeout:   ${config.gateTimeout}ms`);
```

But `HoneConfig` and `ModelConfig` have grown. The `ModelConfig` type has 7 fields (`assess`, `name`, `plan`, `execute`, `gates`, `derive`, `triage`) — but the config command only displays 4 of them. Similarly, `HoneConfig` includes `mode`, `minCharterLength`, and `severityThreshold`, none of which appear in the display output.

This means whenever someone adds a new config field, they must remember to update three places: the type, the `loadConfig()` merge logic, and the display command. Two of those three have already drifted.

This is a violation of the "no knowledge duplication" heuristic — the shape of the config is a single piece of knowledge that's been encoded in multiple locations that must change together for the same reason, and they've already fallen out of sync.

#### 2. JSON/Text Output Branching (secondary, structural duplication)

Every command handler follows this pattern:

```typescript
const isJson = parsed.flags.json === true;
// ... do work ...
if (isJson) {
  writeJson(data);
} else {
  // human-readable output
}
```

This appears in `commands/iterate.ts`, `commands/gates.ts`, `commands/derive.ts`, `commands/list-agents.ts`, `commands/history.ts`, and `commands/config.ts` — six instances. Each one independently extracts the `json` flag, independently branches on it, and independently routes progress output. The `onProgress` callback in `iterateCommand` even has its own inline implementation of the same concern:

```typescript
const onProgress = (stage: string, message: string) => {
  if (isJson) {
    console.error(`==> [${stage}] ${message}`);
  } else {
    console.log(`==> [${stage}] ${message}`);
  }
};
```

While this isn't "wrong" per se (it works, and each command does have different display logic), the flag extraction and progress routing are the same decision encoded in six places.

### How to Correct It

**For the config display drift (highest priority):**

Make the display logic derive from the config object programmatically rather than hardcoding field names. The simplest approach: iterate over the config structure at display time. This eliminates the drift problem entirely — adding a new config field automatically includes it in `hone config` output.

**For the JSON output pattern (lower priority, worth considering):**

Extract the `isJson` flag and `onProgress` creation into a shared utility, perhaps a `CommandContext` that each command receives:

```typescript
interface CommandContext {
  isJson: boolean;
  onProgress: (stage: string, message: string) => void;
}

function createCommandContext(flags: Record<string, string | boolean>): CommandContext {
  const isJson = flags.json === true;
  return {
    isJson,
    onProgress: (stage, message) => {
      const target = isJson ? console.error : console.log;
      target(`==> [${stage}] ${message}`);
    },
  };
}
```

This is optional — the current duplication is mild and each command *does* have different display logic in the non-JSON branch. But the flag extraction and progress routing are the same knowledge.

### What I Would NOT Change

- The overall architecture is excellent — clean separation between pure functions and I/O boundaries
- The dependency injection pattern (ClaudeInvoker, GateRunner, etc.) enables excellent testability
- The test suite is thorough and tests behavior, not implementation
- The type system is well-leveraged (discriminated unions, function types, strict mode)
- The module boundaries reflect the domain well

This is a moderate-severity finding because the drift has already manifested (3 model slots and 3 config fields invisible to `hone config` users), but it doesn't cause incorrect behavior — it's a documentation/discoverability gap that will worsen as the config surface grows.