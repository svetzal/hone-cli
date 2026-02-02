Now I have a clear picture. Here's the plan:

---

## Plan: Fix Config Display Drift — Derive Display from Config Structure

### Problem Summary

The `configCommand` in `src/commands/config.ts` hardcodes which fields to display. It shows only 4 of 7 model slots (`gates`, `derive`, `triage` are missing) and omits 3 top-level config fields (`mode`, `minCharterLength`, `severityThreshold`). This means `hone config` gives users an incomplete picture of their active configuration, and every new config field requires a manual update to the display code.

### Step 1: Update `configCommand` to display all model fields programmatically

**File:** `src/commands/config.ts`

Replace the hardcoded model listing with a loop over `config.models`:

```typescript
console.log(`  Models:`);
for (const [key, value] of Object.entries(config.models)) {
  console.log(`    ${key}: ${value}`);
}
```

This ensures all 7 model slots (`assess`, `name`, `plan`, `execute`, `gates`, `derive`, `triage`) are displayed, and any future model additions are included automatically.

The alignment will change from fixed-width padding to simple `key: value` formatting. This is acceptable — the padding was cosmetic and created maintenance burden without adding clarity.

### Step 2: Update `configCommand` to display all top-level config fields programmatically

**File:** `src/commands/config.ts`

Replace the hardcoded top-level field listing with a loop that handles the `models` object specially and displays everything else:

```typescript
for (const [key, value] of Object.entries(config)) {
  if (key === "models") continue; // already displayed above
  const displayValue = key === "gateTimeout" ? `${value}ms` : String(value);
  console.log(`  ${key}: ${displayValue}`);
}
```

This adds the missing fields (`mode`, `minCharterLength`, `severityThreshold`) and ensures any future additions to `HoneConfig` are automatically displayed.

### Step 3: Update the tests to verify all config fields are displayed

**File:** `src/commands/config.test.ts`

Add a new test that verifies all model names and all top-level config fields appear in the output. The test should check for the presence of each `ModelConfig` key and each `HoneConfig` top-level key (except `models`, which is the group header):

- Verify `gates`, `derive`, and `triage` appear in model output (the three that were missing)
- Verify `mode`, `minCharterLength`, and `severityThreshold` appear in output (the three missing top-level fields)
- Keep the existing tests as they are — they verify backward-compatible behavior (header text, model values, config file path, JSON output structure)

Add to the existing JSON test: verify that the JSON output also includes `mode`, `minCharterLength`, `severityThreshold`, and all 7 model fields, since these were missing from the JSON structure assertions too (though the JSON path already worked correctly via `writeJson(config)`).

### Step 4: Run quality gates

Run the full quality gate suite to verify nothing breaks:

1. `bun test` — all 220+ tests must pass
2. `bunx tsc --noEmit` — zero type errors
3. `bun build src/cli.ts --compile --outfile=build/hone` — binary compiles
4. `./build/hone config` — manually verify the output now shows all fields

### What This Plan Does NOT Do

- **Does not refactor the JSON/text branching pattern across commands.** The assessment identified this as a secondary, lower-priority finding. The existing `output.ts` module already provides `writeJson` and `progress` utilities. The remaining per-command branching is mild duplication that represents genuinely different display logic in each command. Extracting a `CommandContext` abstraction would be premature — the current shape works and each command's display needs differ.

- **Does not change `loadConfig()`.** The merge logic in `config.ts` already enumerates all fields explicitly, which is fine — it's a single function that directly mirrors the type, and the spread operator for models handles additions cleanly. The real drift was in the display layer.

- **Does not change the `HoneConfig` or `ModelConfig` types.** The types are correct as-is. The display just wasn't keeping up.