---
layout: home

hero:
  name: Hone
  text: Iterative Codebase Improvement
  tagline: A CLI that hones your codebase one principle at a time
  actions:
    - theme: brand
      text: The Iteration Pipeline
      link: /concepts/iteration-pipeline
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

- [The Iteration Pipeline](/concepts/iteration-pipeline) — how every stage works and why
- [Project Charter](https://github.com/svetzal/hone-cli/blob/main/CHARTER.md) — design rationale and philosophy
- [README](https://github.com/svetzal/hone-cli/blob/main/README.md) — full CLI reference, installation, and configuration
