#!/usr/bin/env bun

import { configCommand } from "./commands/config.ts";
import { deriveCommand } from "./commands/derive.ts";
import { deriveGatesCommand } from "./commands/derive-gates.ts";
import { gatesCommand } from "./commands/gates.ts";
import { historyCommand } from "./commands/history.ts";
import { initCommand } from "./commands/init.ts";
import { iterateCommand } from "./commands/iterate.ts";
import { listAgentsCommand } from "./commands/list-agents.ts";
import { maintainCommand } from "./commands/maintain.ts";
import { mixCommand } from "./commands/mix.ts";
import { VERSION } from "./constants.ts";
import { CliError } from "./errors.ts";
import type { ParsedArgs } from "./types.ts";

function parseArgs(args: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];

  let i = 0;
  while (i < args.length) {
    const arg = args[i] ?? "";
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith("--")) {
        flags[key] = nextArg;
        i += 2;
      } else {
        flags[key] = true;
        i += 1;
      }
    } else {
      positional.push(arg);
      i += 1;
    }
  }

  return {
    command: positional[0] || "",
    positional: positional.slice(1),
    flags,
  };
}

function printHelp(): void {
  console.log(`
hone - Iterative codebase quality improvement v${VERSION}

Usage: hone <command> [options]

Commands:
  iterate <agent> <folder>   Run one improvement cycle (assess, plan, execute, verify)
  maintain <agent> <folder>  Update dependencies and verify quality gates
  gates [agent] [folder]     Show quality gates for a project (agent enables extraction)
  derive <folder>            Inspect project, generate agent + .hone-gates.json
  derive-gates [agent] <folder>  Generate .hone-gates.json from project inspection
  mix <agent> <folder>       Augment a local agent with ideas from a global agent
  init                       Install hone skill files for Claude Code
  list-agents                Show available agents from ~/.claude/agents/
  history [folder]           Show past iterations from the audit directory
  config                     Show current configuration

Iterate Options:
  --max-retries <n>          Max gate enforcement retries (default: 3)
  --skip-gates               Skip quality gate verification
  --skip-charter             Skip charter clarity check
  --skip-triage              Skip triage stage (severity + busy-work filter)
  --mode <local|github>      Operational mode (default: local)
  --proposals <n>            Number of proposals to generate (github mode only, default: 1)
  --severity-threshold <n>   Minimum severity to proceed (1-5, default: 3)
  --min-charter-length <n>   Minimum charter content length (default: 100)
  --assess-model <model>     Override assessment model (default: opus)
  --plan-model <model>       Override planning model (default: opus)
  --execute-model <model>    Override execution model (default: sonnet)
  --audit-dir <path>         Audit log directory (relative or absolute, default: audit)

Maintain Options:
  --max-retries <n>          Max gate enforcement retries (default: 3)
  --execute-model <model>    Override execution model (default: sonnet)
  --audit-dir <path>         Audit log directory (relative or absolute, default: audit)

Gates Options:
  --run                      Actually run the gates and report results
  --save                     Write resolved gates to .hone-gates.json in project folder

Derive Options:
  --global                   Write agent to ~/.claude/agents/ (default)
  --local                    Write agent to <folder>/.claude/agents/
  --name <name>              Override agent name (skip Claude's naming)

Derive-Gates Options:
  --run                      Run gates after generating
  --derive-model <model>     Override model for project inspection

Init Options:
  --global                   Install to ~/.claude/ (default: .claude/ in cwd)
  --force                    Overwrite even if installed version is newer

Mix Options:
  --from <name>              Foreign agent name (from ~/.claude/agents/)
  --principles               Mix engineering principles / craftsmanship ideals
  --gates                    Mix quality gates / QA checkpoints

General Options:
  --json                     Output machine-readable JSON to stdout
  --help                     Show this help message
  --version                  Show version number

Examples:
  hone iterate typescript-craftsperson ./src
  hone iterate elixir-phoenix-craftsperson ./apps/web --skip-gates
  hone iterate python-craftsperson . --max-retries 5
  hone iterate python-craftsperson . --audit-dir ~/hone-audits/my-project
  hone maintain typescript-craftsperson ./src
  hone gates .
  hone gates typescript-craftsperson .
  hone gates ./apps/web --run
  hone gates typescript-craftsperson . --save
  hone derive .
  hone derive-gates .
  hone derive-gates typescript-craftsperson .
  hone derive-gates . --run
  hone mix local-agent . --from typescript-craftsperson --principles --gates
  hone init
  hone init --global
  hone init --force
  hone list-agents
  hone history .
  hone history . --audit-dir ~/hone-audits/my-project
  hone config
`);
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  const parsed = parseArgs(args);

  if (parsed.flags.version) {
    console.log(`hone v${VERSION}`);
    return;
  }

  if (parsed.flags.help || !parsed.command) {
    printHelp();
    return;
  }

  try {
    switch (parsed.command) {
      case "iterate":
        await iterateCommand(parsed);
        break;
      case "maintain":
        await maintainCommand(parsed);
        break;
      case "gates":
        await gatesCommand(parsed);
        break;
      case "derive":
        await deriveCommand(parsed);
        break;
      case "derive-gates":
        await deriveGatesCommand(parsed);
        break;
      case "init":
        await initCommand(parsed);
        break;
      case "mix":
        await mixCommand(parsed);
        break;
      case "list-agents":
        await listAgentsCommand(parsed);
        break;
      case "history":
        await historyCommand(parsed);
        break;
      case "config":
        await configCommand(parsed);
        break;
      default:
        console.error(`Unknown command: ${parsed.command}`);
        printHelp();
        process.exit(1);
    }
  } catch (error) {
    if (error instanceof CliError) {
      if (error.message) {
        console.error(error.message);
      }
      process.exit(1);
    }
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    }
    process.exit(1);
  }
}

main();
