import { createClaudeInvoker } from "../claude.ts";
import { createProgressCallback } from "../output.ts";
import type { HoneConfig, PipelineContext } from "../types.ts";

export function buildPipelineContext(
  agent: string,
  folder: string,
  config: HoneConfig,
  isJson: boolean,
): PipelineContext {
  const onProgress = createProgressCallback(isJson);
  const claude = createClaudeInvoker({ cwd: folder });
  return { agent, folder, config, claude, onProgress };
}
