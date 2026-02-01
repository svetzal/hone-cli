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
    },
    auditDir: "audit",
    readOnlyTools: "Read Glob Grep WebFetch WebSearch",
    maxRetries: 3,
    gateTimeout: 120_000,
  };
}

export async function loadConfig(): Promise<HoneConfig> {
  const defaults = getDefaultConfig();
  const configPath = join(homedir(), ".config", "hone", "config.json");

  try {
    const file = Bun.file(configPath);
    if (await file.exists()) {
      const userConfig = await file.json();
      return {
        models: { ...defaults.models, ...userConfig.models },
        auditDir: userConfig.auditDir ?? defaults.auditDir,
        readOnlyTools: userConfig.readOnlyTools ?? defaults.readOnlyTools,
        maxRetries: userConfig.maxRetries ?? defaults.maxRetries,
        gateTimeout: userConfig.gateTimeout ?? defaults.gateTimeout,
      };
    }
  } catch {
    // Config file missing or invalid — use defaults
  }

  return defaults;
}
