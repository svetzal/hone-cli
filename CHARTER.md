# Hone — Project Charter

## Vision

Hone wraps the non-deterministic creativity of an LLM in a deterministic
verification loop to iteratively improve codebases. The agent proposes and
executes improvements; hone independently verifies them through quality gates.

The key insight: non-determinism is a feature, not a bug. Each iteration
explores different improvement opportunities that a human might not consider.
But that same eagerness to help creates a problem that must be contained.

## Why this exists

Agents are naturally non-deterministic. They are unlikely to adhere to all of
your rules at the same time. They're prone to leaving things out when things get
complex.

An agent will happily tell you it implemented all your policies, passed all your
guardrails and validations, or confidently tell you why some of them don't
matter. Hone diligently runs all of your validations every time, and the
iteration pushes your implementation closer to your policies and intent.

The iteration pipeline is a mechanism to push an implementation closer to the
guardrails you intended in your custom agent definitions and AGENTS.md files.

## The Busy-Work Problem

LLMs will always find something to suggest. Given the prompt "find the most
violated principle," the agent will produce an answer even when the codebase is
in good shape. This leads to thrashing — cosmetic refactors, unnecessary
abstractions, docstring campaigns, import reorganization, and incidental polish
that takes the project in unintended directions without contributing to its
goals.

Hone must contain this. The agent's creativity is valuable, but only when
directed at substantive improvements that serve the project's stated intent.

## Containment Strategy

Two layers of defense, applied in sequence:

### 1. Automatic Triage

Every assessment passes through a triage stage before any work is proposed or
executed. Triage filters on two dimensions:

- **Severity threshold** — The assessment must produce a structured severity
  rating. Violations below a minimum severity are rejected. A separate,
  skeptical LLM pass evaluates whether the proposed change is substantive or
  busy-work.

- **Change-type classification** — Certain categories are strong busy-work
  signals and are filtered automatically:
  - Adding comments or docstrings to unchanged logic
  - Reorganizing imports or file structure without behavioral change
  - Adding abstractions for single-use code
  - Adding error handling for internal or impossible cases
  - Type annotation campaigns on stable code
  - "Consistency" refactors that don't fix bugs or enable features

If triage rejects a proposal, hone exits cleanly with "nothing substantive to
improve." This is a success state — it means the codebase is in good shape
relative to the agent's principles.

### 2. Approval Workflows

Two operational modes control what happens when a proposal passes triage:

**Local mode** — Everything that passes triage is auto-approved and executed
immediately. Simple, fast, suited for projects not on GitHub or when the user
wants hands-off iteration.

**GitHub mode** — Proposals become GitHub issues. The product owner reviews and
approves (thumbs-up reaction) or rejects (thumbs-down reaction) before any code
changes are made. This gives the human a menu of improvement options to curate.

## Charter Clarity Prerequisite

Hone cannot distinguish substantive improvements from busy-work without
understanding the project's goals. Target projects must have clear intent
documentation — a README with a purpose statement, a CLAUDE.md with a project
charter, or equivalent.

If project intent is insufficient, hone stops before doing any work and directs
the user to write clearer guidance. This is a hard stop, not a warning. Garbage
in, garbage out — unclear intent produces unfocused improvements.

## Design Principles

- **The agent never self-certifies.** Quality gates are run independently by
  hone, not by the agent. The agent does not decide when it's done.

- **Proposals are cheap; execution requires approval.** In GitHub mode, creating
  an issue costs nothing. Changing code requires explicit human sign-off.

- **Failures leave a record but don't block.** Failed proposals are closed with
  full context. The system self-corrects through future assessment cycles.

- **Clear intent is a prerequisite, not a nice-to-have.** Without project goals,
  hone cannot make quality judgments. It refuses to operate rather than guess.

- **Non-determinism is directed, not eliminated.** The LLM's creativity
  explores the improvement space; triage and approval constrain it to the
  project's actual goals.

## Non-Goals

- Replacing the Claude agents — they stay in `~/.claude/agents/`
- Building a GUI or web interface
- Replacing Claude Code — hone orchestrates it
- Managing agent definitions or principles
- Automatic dependency updates or version bumps (use dedicated tools)
- Continuous deployment — hone improves code, not infrastructure
