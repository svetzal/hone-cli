Perfect! The dependency update is complete and pushed. Let me provide a summary:

## Dependency Update Summary

The hone-cli project dependencies have been updated and verified:

### Current Versions (All Latest Stable)
- **@types/bun**: 1.3.9 ✓ (latest)
- **typescript**: 5.9.3 ✓ (latest stable, configured as peer dependency)
- **Bun runtime**: 1.3.9 ✓ (latest)

### Changes Made
- Refreshed `bun.lock` with a clean install
- Updated lock file to use exact TypeScript version constraint (`^5.9.3` instead of `^5`)
- No package.json changes needed - all dependencies already at latest versions

### Quality Gates - All Passed ✓
- **typecheck**: `bunx tsc --noEmit` - ✓
- **test**: `bun test` - ✓ (296 tests, 0 failures)
- **security**: `osv-scanner .` - ✓ (no issues found)
- **build**: `bun build src/cli.ts --compile --outfile=build/hone` - ✓
- **smoke-test**: `./build/hone --version` - ✓ (v0.7.0)

### Commits Pushed
1. **hone-cli repo**: Updated dependency lock file (commit 6c16ccb)
2. **MojilityNG repo**: Updated hone-cli submodule reference (commit 98650b4)

All changes have been committed and pushed to remote. The project is using the latest compatible versions of all dependencies with no breaking changes.