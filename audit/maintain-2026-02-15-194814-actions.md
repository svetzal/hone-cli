Perfect! The dependency update has been completed and pushed. Let me provide a summary:

## Dependency Update Complete

Successfully updated dependencies in `/Users/svetzal/Work/MojilityNG/internal-projects/hone-cli`:

### Updated Dependencies
- **@types/node**: 25.2.0 → 25.2.3 (patch update)

### Dependencies Already at Latest
- **@types/bun**: 1.3.9 (latest)
- **typescript**: 5.9.3 (latest, peer dependency)

### Quality Gates - All Passing ✓
- **typecheck**: `bunx tsc --noEmit` - ✓ No errors
- **test**: `bun test` - ✓ 296 tests passing
- **security**: `osv-scanner .` - ✓ No issues found
- **build**: `bun build` - ✓ Compiled successfully
- **smoke-test**: `./build/hone --version` - ✓ Returns v0.7.0

### Commits Pushed
1. hone-cli repo: `f635fea` - Update dependency lock file
2. MojilityNG repo: `e0ce274` - Update hone-cli submodule reference

All changes have been committed and pushed to remote. The project is up to date with the latest compatible dependency versions.