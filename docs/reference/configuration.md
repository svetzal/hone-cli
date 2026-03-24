# Configuration

Hone's defaults work out of the box. Configuration is optional — use it when you want to change model assignments, timeouts, or default behavior across all projects.

## Config file

Location: `~/.config/hone/config.json`

All fields are optional. Missing fields use built-in defaults.

```json
{
  "models": {
    "assess": "opus",
    "name": "haiku",
    "plan": "opus",
    "execute": "sonnet",
    "gates": "sonnet",
    "derive": "opus",
    "triage": "haiku",
    "mix": "opus",
    "summarize": "haiku"
  },
  "auditDir": "audit",
  "readOnlyTools": "Read Glob Grep WebFetch WebSearch",
  "maxRetries": 3,
  "gateTimeout": 120000,
  "mode": "local",
  "minCharterLength": 100,
  "severityThreshold": 3
}
```

## Precedence

Settings are resolved in this order (highest wins):

1. **CLI flag** — `--assess-model sonnet` overrides everything for that run
2. **Config file** — `~/.config/hone/config.json`
3. **Built-in default** — hardcoded in hone

The `models` object is shallow-merged: setting `"models": { "assess": "sonnet" }` overrides only the assess model while leaving all others at their defaults.

## Fields

### models

Controls which Claude model is used at each pipeline stage.

| Slot | Default | Used in | Rationale |
|------|---------|---------|-----------|
| `assess` | `opus` | Assessment stage | Needs deep understanding to identify the most-violated principle |
| `name` | `haiku` | Filename generation | Trivial task — fast model is fine |
| `plan` | `opus` | Planning stage | Plans benefit from thorough reasoning |
| `execute` | `sonnet` | Code execution | Good balance of capability and speed for writing code |
| `gates` | `sonnet` | Gate extraction from agents | Parsing QA checkpoints into structured commands |
| `derive` | `opus` | Agent derivation | Exploring a project and generating principles needs depth |
| `triage` | `haiku` | Busy-work detection | Classification task — fast model works well |
| `mix` | `opus` | Agent mixing | Merging principles thoughtfully needs depth |
| `summarize` | `haiku` | Commit message generation | Simple summarization task |

Valid model values: `opus`, `sonnet`, `haiku`. These map to Claude model tiers. Use the Claude Code CLI's model naming (not full model IDs).

**Cost vs quality trade-off:** If you want faster, cheaper iterations, try `sonnet` for assessment and planning. The results will be less thorough but still useful for well-defined codebases. The `haiku` slots should generally stay on `haiku` — they handle simple classification and formatting tasks.

### auditDir

| Type | Default |
|------|---------|
| string | `"audit"` |

Directory where audit files (assessments, plans, execution logs) are written. Relative paths are resolved from the project directory. Absolute paths are used as-is.

### readOnlyTools

| Type | Default |
|------|---------|
| string | `"Read Glob Grep WebFetch WebSearch"` |

Space-separated list of Claude Code tools allowed during read-only stages (assessment, planning, triage). You shouldn't need to change this unless you want to restrict or extend tool access.

### maxRetries

| Type | Default | Range |
|------|---------|-------|
| number | `3` | 0+ |

Maximum number of times hone will send the agent back to fix gate failures after execution. The total number of execution attempts is `maxRetries + 1` (the initial attempt plus retries).

### gateTimeout

| Type | Default |
|------|---------|
| number (ms) | `120000` |

Default timeout in milliseconds for each gate command. If a command exceeds this, the process is killed and the gate is marked as failed. Increase this for projects with slow test suites.

Individual gates can override this value with a `timeout` field in `.hone-gates.json`. Per-gate timeouts take precedence over the global `gateTimeout`. Gates without a `timeout` field fall back to this value.

### mode

| Type | Default | Values |
|------|---------|--------|
| string | `"local"` | `"local"`, `"github"` |

Default operational mode. Local mode executes immediately; GitHub mode creates issues for approval. See [GitHub Mode](/concepts/github-mode).

### minCharterLength

| Type | Default |
|------|---------|
| number | `100` |

Minimum character count for a project's intent documentation to pass the charter check. Sources checked: `CHARTER.md`, the `## Project Charter` section of `CLAUDE.md`, `README.md`, and the `description` field in package manager configs.

### severityThreshold

| Type | Default | Range |
|------|---------|-------|
| number | `3` | 1-5 |

Minimum severity rating for a proposal to proceed past triage. The severity scale:

| Level | Label | Meaning |
|-------|-------|---------|
| 1 | Cosmetic | Style nits, formatting |
| 2 | Minor | Low-impact improvements |
| 3 | Moderate | Meaningful issues worth fixing |
| 4 | Significant | Important problems |
| 5 | Critical | Must-fix issues |

Lowering the threshold (e.g. to 2) makes hone more aggressive about improvements. Raising it (e.g. to 4) limits changes to significant and critical issues only.

## Viewing active config

```bash
hone config
```

Prints the fully resolved configuration (defaults merged with your config file). Useful for verifying what hone will actually use.
