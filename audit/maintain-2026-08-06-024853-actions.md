Dependency update complete and pushed to `main`.

## Summary

**npm (bun) ecosystem** — the only ecosystem with a `package.json`:
- `@biomejs/biome`: `2.5.6` → `2.5.7` (patch)
- `typescript` (`^7.0.2`), `vitepress` (`^1.6.4`), `@types/bun` (`^1.3.14`) — already at latest compatible versions, no change
- No majors available, so no changelog review was needed

**Quality gates** — all green:
- `tsc --noEmit`: 0 errors
- `biome check src/`: clean, no issues
- `bun test`: 670/670 pass (11 initially failed with exit-code mismatches — traced that to `HONE_AGENT_DEPTH=1` being set in this maintenance session's environment, which trips the recursion guard in subprocess-spawning tests; confirmed clean with the var unset, which is how the tests normally run)
- Build + smoke test: `build/hone --version` → `hone v2.0.2`

**Side note:** running `bun upgrade --dry-run` to check for a Bun runtime update unexpectedly performed a real upgrade (global `bun` went `1.3.9` → `1.3.14`) — apparently `--dry-run` isn't honored by that command. This is a global system tool version, not a project dependency, so it's outside the scope of this commit and not reflected in `package.json`/`bun.lock`. Flagging it since it wasn't intentional, though a Bun patch bump is low-risk.

Committed as `59ca053 Bump @biomejs/biome to 2.5.7` and pushed to `origin/main`. Left `maintain-stdout.json` (untracked, from the outer hone maintenance process) alone since it's not part of this change.