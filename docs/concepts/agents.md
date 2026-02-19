# Agents & Principles

Agents are the engineering brain behind hone's assessments. An agent is a markdown file that defines engineering principles for a domain — what "good" looks like for a particular technology stack. Hone reads the agent, asks it to assess your project, and uses its principles to identify what to fix.

## What's in an agent

An agent file contains:

- **Engineering principles** — the standards your code should meet (e.g. "functions should have a single responsibility", "all public APIs must have error handling")
- **QA checkpoints** — concrete commands for testing, linting, type checking, and security scanning
- **Coding guidelines** — conventions for the language and framework
- **Architecture guidance** — patterns to follow and anti-patterns to avoid

The agent is used in two ways during an iteration:

1. **Assessment** (read-only) — Claude reads your project through the lens of the agent's principles and identifies the most-violated one
2. **Execution** (full access) — Claude applies the planned fix, guided by the agent's coding guidelines

## Where agents live

Agents can be stored in two locations:

| Location | Scope | Flag |
|----------|-------|------|
| `~/.claude/agents/` | Global — available to all projects | `--global` (default for derive) |
| `<project>/.claude/agents/` | Local — version-controlled with the project | `--local` |

When you run `hone iterate`, both locations are checked. Local agents take the same precedence as global ones — hone looks in global first, then local.

File extensions: `.md` is standard. The legacy `.agent.md` extension is still recognized for backward compatibility.

## Three ways to get an agent

### 1. Generate with `hone derive`

The fastest path. Derive explores your project's source code, build files, CI configs, and tooling, then generates an agent with principles specific to your stack:

```bash
hone derive /path/to/project           # writes to ~/.claude/agents/
hone derive /path/to/project --local   # writes to <project>/.claude/agents/
```

The generated agent name follows the convention `<technology>-craftsperson` (e.g. `typescript-craftsperson`, `python-craftsperson`). Derive also creates a `.hone-gates.json` file with quality gate commands discovered from your project.

### 2. Use a pre-built agent

The [svetzal/guidelines](https://github.com/svetzal/guidelines/tree/main/agents) repository has agents for common stacks. Download one to `~/.claude/agents/`:

```bash
curl -o ~/.claude/agents/typescript-craftsperson.md \
  https://raw.githubusercontent.com/svetzal/guidelines/main/agents/typescript-craftsperson.md
```

### 3. Write your own

Create a markdown file in `~/.claude/agents/`. The filename (minus `.md`) becomes the agent name. An effective agent should:

- Be **opinionated** — weak principles produce weak assessments
- Include **concrete commands** in QA checkpoints — hone can extract these as quality gates
- Cover both **what to do** and **what not to do** — anti-patterns are as important as patterns

## Mixing agents

The `hone mix` command augments a local agent with ideas from a global one. This is useful when you've derived a project-specific agent but want to incorporate principles from a more comprehensive reference agent:

```bash
hone mix <foreign-agent> /path/to/project --principles   # mix engineering principles
hone mix <foreign-agent> /path/to/project --gates         # mix QA checkpoints
hone mix <foreign-agent> /path/to/project --principles --gates  # both
```

Mix rules:

- The **local agent** (in `<project>/.claude/agents/`) is the target that gets modified
- The **foreign agent** (in `~/.claude/agents/`) provides the ideas to incorporate
- Existing local principles take priority — conflicting principles are skipped
- Technology must match — mix won't add `tsc` commands to a Python agent
- At least one of `--principles` or `--gates` is required

## Agent contract

Hone discovers agents but never modifies them (except during `derive` and `mix`). The agent must work with both tool sets:

- **Read-only tools** (`Read Glob Grep WebFetch WebSearch`) — used during assessment and planning stages
- **Full tool access** — used during the execution stage

The agent doesn't need to know about hone's pipeline. It just needs to define clear principles and be capable of both analyzing code and writing fixes.
