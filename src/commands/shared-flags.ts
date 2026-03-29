import type { HoneConfig } from "../types.ts";

export function applySharedFlags(config: HoneConfig, flags: Record<string, string | boolean>): HoneConfig {
  const result = { ...config, models: { ...config.models } };

  if (typeof flags["max-retries"] === "string") {
    result.maxRetries = parseInt(flags["max-retries"], 10);
  }
  if (typeof flags["execute-model"] === "string") {
    result.models.execute = flags["execute-model"];
  }
  if (typeof flags["summarize-model"] === "string") {
    result.models.summarize = flags["summarize-model"];
  }
  if (typeof flags["audit-dir"] === "string") {
    result.auditDir = flags["audit-dir"];
  }

  return result;
}
