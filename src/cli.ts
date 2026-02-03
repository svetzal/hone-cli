#!/usr/bin/env bun

import { iterateCommand } from "./commands/iterate.ts";
import { listAgentsCommand } from "./commands/list-agents.ts";
import { gatesCommand } from "./commands/gates.ts";
import { deriveCommand } from "./commands/derive.ts";
import { historyCommand } from "./commands/history.ts";
import { configCommand } from "./commands/config.ts";
import type { ParsedArgs } from "./types.ts";

const VERSION = "0.4.1";

function parseArgs(args: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];

  let i = 0;
  while (i < args.length) {
    const arg = args[i]!;
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
  gates [agent] [folder]     Show quality gates for a project (agent enables extraction)
  derive <folder>            Inspect project, generate agent + .hone-gates.json
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

Gates Options:
  --run                      Actually run the gates and report results
  --save                     Write resolved gates to .hone-gates.json in project folder

Derive Options:
  --local                    Write agent to <folder>/.claude/agents/ (instead of global)
  --global                   Write agent to ~/.claude/agents/ (default)

General Options:
  --json                     Output machine-readable JSON to stdout
  --help                     Show this help message
  --version                  Show version number

Examples:
  hone iterate typescript-craftsperson ./src
  hone iterate elixir-phoenix-craftsperson ./apps/web --skip-gates
  hone iterate python-craftsperson . --max-retries 5
  hone gates .
  hone gates typescript-craftsperson .
  hone gates ./apps/web --run
  hone gates typescript-craftsperson . --save
  hone derive .
  hone list-agents
  hone history .
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
      case "gates":
        await gatesCommand(parsed);
        break;
      case "derive":
        await deriveCommand(parsed);
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
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    }
    process.exit(1);
  }
}

main();
