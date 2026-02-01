import { resolve, join } from "path";
import { loadConfig } from "../config.ts";
import { listIterations } from "../audit.ts";
import type { ParsedArgs } from "../types.ts";

export async function historyCommand(parsed: ParsedArgs): Promise<void> {
  const folder = resolve(parsed.positional[0] || ".");
  const config = await loadConfig();
  const auditDir = join(folder, config.auditDir);

  const iterations = await listIterations(auditDir);

  if (iterations.length === 0) {
    console.log(`No iteration history found in ${auditDir}`);
    return;
  }

  console.log(`Iteration history (${auditDir}):\n`);
  for (const entry of iterations) {
    const date = entry.date.toISOString().slice(0, 16).replace("T", " ");
    console.log(`  ${date}  ${entry.name}`);
    for (const file of entry.files) {
      console.log(`              ${file}`);
    }
  }
  console.log(`\n${iterations.length} iteration(s)`);
}
