import { resolve } from "path";
import { detectGates, runAllGates } from "../gates.ts";
import { loadConfig } from "../config.ts";
import type { ParsedArgs } from "../types.ts";

export async function gatesCommand(parsed: ParsedArgs): Promise<void> {
  const folder = resolve(parsed.positional[0] || ".");
  const shouldRun = parsed.flags.run === true;

  const gates = await detectGates(folder);

  if (gates.length === 0) {
    console.log(`No quality gates detected for ${folder}`);
    return;
  }

  if (!shouldRun) {
    console.log(`Quality gates for ${folder}:\n`);
    for (const gate of gates) {
      const tag = gate.required ? "required" : "optional";
      console.log(`  [${tag}] ${gate.name}: ${gate.command}`);
    }
    return;
  }

  const config = await loadConfig();

  console.log(`Running quality gates for ${folder}...\n`);
  const result = await runAllGates(folder, config.gateTimeout);

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
