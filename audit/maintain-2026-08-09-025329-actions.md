Done. Summary:

**Dependency updates applied** (commit `c0a83e3`, pushed to `origin/main`):
- `esbuild` override `^0.28.1` → `^0.28.2` (patch)
- `postcss` override `^8.5.25` → `^8.5.26` (patch)
- `rollup` (`^4.62.4`) and `vite` (`^6.4.3`) were already at the latest version within their pinned ranges — vite has a major `7.x`/`8.x` available but I left it alone per "prefer minor/patch" guidance (a major vite bump wasn't warranted for a routine pass).
- All four `devDependencies` (`@biomejs/biome`, `@types/bun`, `typescript`, `vitepress`) were already at latest.
- Lockfile refresh also picked up compatible transitive bumps (e.g. `@algolia/*` 5.52 → 5.56, vitepress's search integration).

**Cleanup**: removed a stray, never-committed `"dependencies"` block from `package.json` that misdeclared `esbuild`/`postcss` as runtime deps of hone-cli — they're actually transitive build-tool deps of `vitepress` (docs only), already correctly pinned via `overrides`.

**Quality gates** — all 5 pass: typecheck, lint, `bun test` (670/670), build, smoke-test (`hone v2.0.2`).

**One note, not blocking**: `bun run docs:build` fails with an esbuild/vite target-transform error ("Transforming destructuring... not supported"). I verified via `git stash` that this was **already broken on the previously-committed lockfile**, before any of my changes — not a regression from this update, and not one of the declared quality gates, so I left it out of scope. Worth a separate look at the vite `build.target` config in `docs/.vitepress/config` if docs deploys are currently failing in CI.