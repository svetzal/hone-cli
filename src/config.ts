import { join } from "path";
import { homedir } from "os";
import type { HoneConfig } from "./types.ts";

export function getDefaultConfig(): HoneConfig {
  return {
    models: {
      assess: "opus",
      name: "haiku",
      plan: "opus",
      execute: "sonnet",
      gates: "haiku",
      derive: "opus",
      triage: "haiku",
    },
    auditDir: "audit",
    readOnlyTools: "Read Glob Grep WebFetch WebSearch",
    maxRetries: 3,
    gateTimeout: 120_000,
    mode: "local",
    minCharterLength: 100,
    severityThreshold: 3,
  };
}

export async function loadConfig(configPath?: string): Promise<HoneConfig> {
  const defaults = getDefaultConfig();
  const resolvedPath = configPath ?? join(homedir(), ".config", "hone", "config.json");

  try {
    const file = Bun.file(resolvedPath);
    if (await file.exists()) {
      const userConfig = await file.json();
      return {
        models: { ...defaults.models, ...userConfig.models },
        auditDir: userConfig.auditDir ?? defaults.auditDir,
        readOnlyTools: userConfig.readOnlyTools ?? defaults.readOnlyTools,
        maxRetries: userConfig.maxRetries ?? defaults.maxRetries,
        gateTimeout: userConfig.gateTimeout ?? defaults.gateTimeout,
        mode: userConfig.mode ?? defaults.mode,
        minCharterLength: userConfig.minCharterLength ?? defaults.minCharterLength,
        severityThreshold: userConfig.severityThreshold ?? defaults.severityThreshold,
      };
    }
  } catch {
    // Config file missing or invalid — use defaults
  }

  return defaults;
}
