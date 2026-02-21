The agent has been written to `/Users/svetzal/Work/Projects/Mojility/hone-cli/.claude/agents/bun-typescript-cli-craftsperson.md`.

The name `bun-typescript-cli-craftsperson` distinguishes this from the existing `typescript-bun-cli-craftsperson` and `typescript-craftsperson` agents while reflecting the project's actual toolchain: Bun runtime, TypeScript, CLI tool (no framework).

Key aspects of the derived agent:

- **10 engineering principles** drawn directly from patterns observed in the code: dependency injection via typed function signatures, preflight validation before expensive work, retry with cumulative context, triage to filter busy-work, graceful degradation for optional stages
- **QA checkpoints** use the exact commands from `package.json` scripts and CI config: `bun test` and `bunx tsc --noEmit`
- **Architecture section** maps the actual module organization and documents the key patterns (injectable subprocess execution, prompt-based mock dispatch, structured LLM output)
- **Anti-patterns** are specific to this codebase: no linters (TypeScript strict mode is the lint layer), no external test deps, no Bun global mocking, no `fs` module usage