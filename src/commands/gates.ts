import { resolve, join } from "path";
import { runAllGates } from "../gates.ts";
import { loadOverrideGates, resolveGates } from "../resolve-gates.ts";
import { loadConfig } from "../config.ts";
import { createClaudeInvoker } from "../claude.ts";
import type { ParsedArgs, GateDefinition } from "../types.ts";
import { writeJson, progress } from "../output.ts";

export interface GatesArgs {
  agentName: string | undefined;
  folder: string;
}

export function parseGatesArgs(positional: string[]): GatesArgs {
  // Detect whether first positional is an agent name or a folder path
  // Agent names don't contain slashes or dots (except in filenames)
  const hasAgent = positional.length >= 2 ||
    (positional.length === 1 && !positional[0]!.includes("/") && !positional[0]!.startsWith("."));

  if (positional.length >= 2) {
    return { agentName: positional[0], folder: resolve(positional[1]!) };
  } else if (hasAgent) {
    return { agentName: positional[0], folder: resolve(".") };
  } else {
    return { agentName: undefined, folder: resolve(positional[0] || ".") };
  }
}

export async function gatesCommand(parsed: ParsedArgs): Promise<void> {
  const { agentName, folder } = parseGatesArgs(parsed.positional);

  const shouldRun = parsed.flags.run === true;
  const shouldSave = parsed.flags.save === true;
  const isJson = parsed.flags.json === true;
  const config = await loadConfig();

  let gates: GateDefinition[];

  if (agentName) {
    // With agent: use full resolution chain (override > agent extraction)
    gates = await resolveGates(
      folder,
      agentName,
      config.models.gates,
      config.readOnlyTools,
      createClaudeInvoker(),
    );
  } else {
    // Without agent: only use override file
    gates = (await loadOverrideGates(folder)) ?? [];
  }

  // Handle empty gates case
  if (gates.length === 0) {
    if (isJson) {
      writeJson([]);
    } else {
      const hint = agentName
        ? `No quality gates found for ${folder} (checked .hone-gates.json and agent '${agentName}')`
        : `No quality gates found for ${folder} (no .hone-gates.json present)`;
      console.log(hint);
    }
    return;
  }

  // Handle --save flag (independent of --json)
  if (shouldSave) {
    const gatesPath = join(folder, ".hone-gates.json");
    await Bun.write(gatesPath, JSON.stringify({ gates }, null, 2) + "\n");
    progress(isJson, `Gates written to: ${gatesPath}`);
  }

  // Mode 1: List gates (no --run)
  if (!shouldRun) {
    if (isJson) {
      writeJson(gates);
    } else {
      console.log(`Quality gates for ${folder}:\n`);
      for (const gate of gates) {
        const tag = gate.required ? "required" : "optional";
        console.log(`  [${tag}] ${gate.name}: ${gate.command}`);
      }
    }
    return;
  }

  // Mode 2: Run gates (--run)
  progress(isJson, `Running quality gates for ${folder}...\n`);
  const result = await runAllGates(gates, folder, config.gateTimeout);

  if (isJson) {
    writeJson(result);
  } else {
    for (const r of result.results) {
      const icon = r.passed ? "PASS" : "FAIL";
      const tag = r.required ? "required" : "optional";
      console.log(`  [${icon}] ${r.name} (${tag})`);
      if (!r.passed) {
        const indented = r.output.split("\n").map((l) => `    ${l}`).join("\n");
        console.log(indented);
      }
    }

    console.log();
    if (result.requiredPassed) {
      console.log("All required gates passed.");
    } else {
      console.log("Required gates failed.");
    }
  }

  // Exit code remains the same for both modes
  if (!result.requiredPassed) {
    process.exit(1);
  }
}
