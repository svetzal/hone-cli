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
    for (const [key, value] of Object.entries(config.models)) {
      console.log(`    ${key}: ${value}`);
    }

    for (const [key, value] of Object.entries(config)) {
      if (key === "models") continue; // already displayed above
      const displayValue = key === "gateTimeout" ? `${value}ms` : String(value);
      console.log(`  ${key}: ${displayValue}`);
    }

    console.log(`\nConfig file: ~/.config/hone/config.json`);
  }
}
