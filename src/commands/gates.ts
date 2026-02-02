import { resolve, join } from "path";
import { runAllGates } from "../gates.ts";
import { loadOverrideGates, resolveGates } from "../resolve-gates.ts";
import { loadConfig } from "../config.ts";
import { createClaudeInvoker } from "../claude.ts";
import type { ParsedArgs, GateDefinition } from "../types.ts";

export async function gatesCommand(parsed: ParsedArgs): Promise<void> {
  // Detect whether first positional is an agent name or a folder path
  // Agent names don't contain slashes or dots (except in filenames)
  const hasAgent = parsed.positional.length >= 2 ||
    (parsed.positional.length === 1 && !parsed.positional[0]!.includes("/") && !parsed.positional[0]!.startsWith("."));

  let agentName: string | undefined;
  let folder: string;

  if (parsed.positional.length >= 2) {
    agentName = parsed.positional[0];
    folder = resolve(parsed.positional[1]!);
  } else if (hasAgent) {
    agentName = parsed.positional[0];
    folder = resolve(".");
  } else {
    folder = resolve(parsed.positional[0] || ".");
  }

  const shouldRun = parsed.flags.run === true;
  const shouldSave = parsed.flags.save === true;
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

  if (gates.length === 0) {
    const hint = agentName
      ? `No quality gates found for ${folder} (checked .hone-gates.json and agent '${agentName}')`
      : `No quality gates found for ${folder} (no .hone-gates.json present)`;
    console.log(hint);
    return;
  }

  if (shouldSave) {
    const gatesPath = join(folder, ".hone-gates.json");
    await Bun.write(gatesPath, JSON.stringify({ gates }, null, 2) + "\n");
    console.log(`Gates written to: ${gatesPath}`);
  }

  if (!shouldRun) {
    console.log(`Quality gates for ${folder}:\n`);
    for (const gate of gates) {
      const tag = gate.required ? "required" : "optional";
      console.log(`  [${tag}] ${gate.name}: ${gate.command}`);
    }
    return;
  }

  console.log(`Running quality gates for ${folder}...\n`);
  const result = await runAllGates(gates, folder, config.gateTimeout);

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
    process.exit(1);
  }
}
