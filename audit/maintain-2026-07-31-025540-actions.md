## Summary

Checked every dependency (npm + overrides) against latest published versions:

| Package | Before | After | Notes |
|---|---|---|---|
| `postcss` (override) | `^8.5.23` | `^8.5.25` | patch bump, applied |
| `esbuild` (override) | `^0.28.1` | — | already latest |
| `rollup` (override) | `^4.62.3` | — | already latest |
| `@biomejs/biome` | `^2.5.6` | — | already latest |
| `@types/bun` | `^1.3.14` | — | already latest |
| `typescript` | `^7.0.2` | — | already latest |
| `vitepress` | `^1.6.4` | — | already latest |

**`vite` override left untouched** — currently pinned to `^6.4.3`, which is the latest 6.x release. npm's `latest` tag for vite is now `8.2.0`, but vitepress `1.6.4`'s own `package.json` declares `vite: ^5.4.14` as a dependency — the existing override already pins one major above what vitepress asks for (established by prior maintenance commits, presumably for a security fix). Jumping two more majors (6→7→8) to an unverified line risks breaking `docs:build`/`docs:dev`, so per the "prefer minor/patch, only take a major if no breaking changes for this project" guidance, I left it alone.

Quality gates after the update (with `HONE_AGENT_DEPTH` unset, since this session's own recursion guard was causing 11 unrelated pre-existing test failures — see below):

- `tsc --noEmit` — 0 errors
- `biome check src/` — clean
- `bun test` — 670 pass, 0 fail
- `bun build --compile` — succeeds
- `./build/hone --version` — `hone v2.0.2`

**Aside (not part of the dependency update):** `bun test` initially showed 11 failures in `resolve-command-args.test.ts`, all expecting exit code `1` but getting `2`. Root cause: this session itself has `HONE_AGENT_DEPTH=1` set (since it's running inside a hone maintenance run), and those tests spawn `bun run src/cli.ts ...` subprocesses that inherit that env var, tripping the recursion guard before reaching normal arg-validation. Confirmed by re-running with `env -u HONE_AGENT_DEPTH` — all 670 tests pass. This is an artifact of the sandboxed environment, not a regression, so no code change was made for it.

Committed and pushed directly to `main` (trunk-based, per your global instructions): `30fff5d Bump postcss to 8.5.25`.