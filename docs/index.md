---
layout: home

hero:
  name: Hone
  text: Iterative Codebase Improvement
  tagline: A CLI that hones your codebase one principle at a time
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started/installation
    - theme: alt
      text: View on GitHub
      link: https://github.com/svetzal/hone-cli

features:
  - title: Agent-Driven Assessment
    details: Your agent defines the engineering principles. Hone finds the one your code violates most and plans a fix.
  - title: Independent Verification
    details: The agent never self-certifies. Hone runs your quality gates as subprocesses and checks exit codes.
  - title: Busy-Work Containment
    details: Triage filters out cosmetic refactors, docstring campaigns, and import reorganization before any code changes happen.
  - title: GitHub Approval Workflow
    details: In GitHub mode, proposals become issues. The product owner approves or rejects before any code changes are made.
---

## Quick Start

```bash
# Install
brew tap svetzal/tap
brew install hone

# Generate an agent and quality gates for your project
hone derive /path/to/project

# Run your first improvement iteration
hone iterate <agent-name> /path/to/project
```

## Learn More

- [Installation](/getting-started/installation) — prerequisites and platform-specific setup
- [First Iteration](/getting-started/first-iteration) — walkthrough from derive to iterate
- [Iteration Pipeline](/concepts/iteration-pipeline) — how every stage works and why
- [Agents & Principles](/concepts/agents) — what agents are and how to create them
- [Quality Gates](/concepts/quality-gates) — independent verification of every change
- [CLI Commands](/reference/cli-commands) — all commands, flags, and examples
