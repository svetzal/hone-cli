import { createClaudeInvoker } from "../claude.ts";
import { loadConfig } from "../config.ts";
import { runDerive } from "../derive-command.ts";
import { createProgressCallback, writeJson } from "../output.ts";
import type { PromptFn } from "../prompt.ts";
import { promptChoice } from "../prompt.ts";
import type { ClaudeInvoker, ParsedArgs } from "../types.ts";
import { resolveDeriveArgs } from "./resolve-derive-args.ts";

export async function deriveCommand(
  parsed: ParsedArgs,
  deps?: { prompt?: PromptFn; claude?: ClaudeInvoker },
): Promise<void> {
  const args = resolveDeriveArgs(parsed);
  const config = await loadConfig();
  const claude = deps?.claude ?? createClaudeInvoker();
  const prompt = deps?.prompt ?? promptChoice;
  const onProgress = createProgressCallback(args.isJson);

  const outcome = await runDerive(args, { claude, prompt, config }, onProgress);

  if (outcome === null) {
    onProgress("derive", "Aborted.");
    return;
  }

  if (args.isJson) {
    writeJson({
      agentName: outcome.agentName,
      agentPath: outcome.agentPath,
      gates: outcome.gates,
      gatesPath: outcome.gatesPath,
      gateValidation: outcome.gateValidation,
    });
  } else {
    console.log(`\nDone. Agent name: ${outcome.agentName}`);
    console.log(`Run: hone iterate ${outcome.agentName} ${args.resolvedFolder}`);
  }
}
