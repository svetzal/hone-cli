import { loadConfig } from "../config.ts";
import type { ParsedArgs } from "../types.ts";
import { writeJson } from "../output.ts";

export async function configCommand(parsed: ParsedArgs): Promise<void> {
  const config = await loadConfig();

  const isJson = parsed.flags.json === true;

  if (isJson) {
    writeJson(config);
  } else {
    console.log("Current configuration:\n");
    console.log(`  Models:`);
    console.log(`    assess:   ${config.models.assess}`);
    console.log(`    name:     ${config.models.name}`);
    console.log(`    plan:     ${config.models.plan}`);
    console.log(`    execute:  ${config.models.execute}`);
    console.log(`  Audit dir:      ${config.auditDir}`);
    console.log(`  Read-only tools: ${config.readOnlyTools}`);
    console.log(`  Max retries:    ${config.maxRetries}`);
    console.log(`  Gate timeout:   ${config.gateTimeout}ms`);
    console.log(`\nConfig file: ~/.config/hone/config.json`);
  }
}
