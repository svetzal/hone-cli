Committed and pushed to `origin/main` (`1e9f2b9`).

**Summary:**
- npm ecosystem checked: `postcss` bumped 8.5.18 → 8.5.20 (patch, transitive via the `overrides` field), `nanoid` came along transitively (3.3.12 → 3.3.16). Everything else (`typescript`, `@biomejs/biome`, `@types/bun`, `vitepress`, `esbuild`, `rollup`) was already at latest.
- `vite`'s override (6.4.3) has a major available (8.1.5) but I skipped it — two majors past what vitepress 1.6.4 declares support for, and no local gate exercises the docs build to verify it's safe.
- GitHub Actions in `.github/workflows/` have several majors available too (checkout, upload/download-artifact, action-gh-release, pages actions) — left untouched since that's a separate ecosystem with nothing here to verify it against; worth a dedicated follow-up.
- All five quality gates (typecheck, lint, test, build, smoke-test) pass. Note: the first `bun test` run showed 11 failures, but those were a pre-existing artifact of `HONE_AGENT_DEPTH=1` being set in this shell (subprocess-spawned `hone` CLI hits the recursion guard), not caused by the dependency bump — confirmed by rerunning with the var unset, which gave 670/670 passing.

The two untracked files (`maintain-stderr.log`, `maintain-stdout.json`) in the working tree are unrelated pre-existing artifacts — I left them alone and out of the commit.