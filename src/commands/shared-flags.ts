import { CliError } from "../errors.ts";
import type { HoneConfig } from "../types.ts";

export function parseIntFlag(name: string, value: string): number {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) throw new CliError(`--${name} must be an integer, got: ${value}`);
  return parsed;
}

export function applySharedFlags(config: HoneConfig, flags: Record<string, string | boolean>): HoneConfig {
  const result = { ...config, models: { ...config.models } };

  if (typeof flags["max-retries"] === "string") {
    result.maxRetries = parseIntFlag("max-retries", flags["max-retries"]);
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
