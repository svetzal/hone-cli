Dependency update complete. Summary:

**Findings:**
- Only one ecosystem in this project: npm/bun (no other package manifests present).
- Checked all direct/override deps against latest npm registry versions: `@biomejs/biome`, `@types/bun`, `typescript`, `vitepress`, `esbuild`, and `postcss` were already at their latest available versions.
- `rollup` (pinned via `overrides`) had a patch release available: `4.62.3` → `4.62.4`. Applied it.
- `vite` (also pinned via `overrides`) is intentionally held at `6.4.3`, already ahead of vitepress's declared peer range (`^5.4.14`). Latest upstream is `8.2.0` — two majors ahead — so per the "only apply majors with no breaking changes affecting this project" rule, I left it alone rather than risk breaking the docs build.

**Verification (gates run directly via Bash, not through `hone`):**
- `typecheck`: clean, zero errors
- `lint`: clean, zero warnings (116 files)
- `test`: 670/670 pass — note: an initial run showed 11 failures, but that was an artifact of `HONE_AGENT_DEPTH=1` leaking into this session's shell environment (the recursion guard your test suite exercises), not a regression from the dependency bump. Re-ran with that var unset and got a clean pass; this is a test-harness quirk of running the update from inside a hone session, not a real problem.
- `build`: compiles cleanly
- `smoke-test`: `./build/hone --version` → `hone v2.0.2`

Committed as `cd6fd49` (`Bump rollup override to 4.62.4`) and pushed to `origin/main` per trunk-based workflow.

One housekeeping note: there are two untracked stray files in the repo root — `maintain-stderr.log` and `maintain-stdout.json` — left over from a previous `hone maintain` run. I didn't touch them since they're outside this task's scope, but you may want to `.gitignore` or delete them.