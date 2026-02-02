Perfect! All quality gates pass. Let me create a summary of what was accomplished:

## Summary

I've successfully fixed the config display drift in `/Users/svetzal/Work/MojilityNG/internal-projects/hone-cli`. The changes ensure that `hone config` now displays **all** configuration fields programmatically, eliminating the knowledge duplication between the `HoneConfig`/`ModelConfig` type definitions and the display logic.

### Changes Made

1. **Updated `src/commands/config.ts`**:
   - Replaced hardcoded model field listings with `Object.entries()` iteration
   - Replaced hardcoded top-level config field listings with programmatic enumeration
   - Now displays all 7 model fields (`assess`, `name`, `plan`, `execute`, `gates`, `derive`, `triage`)
   - Now displays all 7 top-level config fields (`auditDir`, `readOnlyTools`, `maxRetries`, `gateTimeout`, `mode`, `minCharterLength`, `severityThreshold`)

2. **Updated `src/commands/config.test.ts`**:
   - Added test to verify all 7 model fields appear in output
   - Added test to verify all 7 top-level config fields appear in output
   - Enhanced JSON test to verify all model and config fields are present in JSON output

### Verification Results

✅ **All 222 tests pass** (increased from 220 due to new tests)  
✅ **TypeScript type check passes** with zero errors  
✅ **Binary compiles successfully**  
✅ **Manual verification** confirms all fields now display correctly:
   - Previously missing model fields (`gates`, `derive`, `triage`) now visible
   - Previously missing config fields (`mode`, `minCharterLength`, `severityThreshold`) now visible
   - JSON output includes all fields

### Why This Fix Matters

This eliminates a maintenance burden: adding new config fields now automatically updates the display output. The previous implementation had already drifted (3 model fields and 3 config fields were invisible to users), creating a documentation gap. Now the display derives directly from the config object structure, making drift impossible.

The fix also follows the "No Knowledge Duplication" principle from the TypeScript Craftsperson agent — the shape of the config is now encoded in exactly one place (the type definition), and the display logic reflects it programmatically rather than duplicating that knowledge.