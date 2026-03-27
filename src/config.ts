import { join } from "path";
import { homedir } from "os";
import type { HoneConfig, HoneMode } from "./types.ts";

export function getDefaultConfig(): HoneConfig {
  return {
    models: {
      assess: "opus",
      name: "haiku",
      plan: "opus",
      execute: "sonnet",
      gates: "sonnet",
      derive: "opus",
      triage: "haiku",
      mix: "opus",
      summarize: "haiku",
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

const MODEL_FIELDS = ["assess", "name", "plan", "execute", "gates", "derive", "triage", "mix", "summarize"] as const;
const VALID_MODES: HoneMode[] = ["local", "github"];

export function validateUserConfig(raw: unknown): Partial<HoneConfig> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};

  const obj = raw as Record<string, unknown>;
  const result: Partial<HoneConfig> = {};

  if (typeof obj.auditDir === "string") result.auditDir = obj.auditDir;
  if (typeof obj.readOnlyTools === "string") result.readOnlyTools = obj.readOnlyTools;
  if (typeof obj.maxRetries === "number") result.maxRetries = obj.maxRetries;
  if (typeof obj.gateTimeout === "number") result.gateTimeout = obj.gateTimeout;
  if (typeof obj.minCharterLength === "number") result.minCharterLength = obj.minCharterLength;
  if (typeof obj.severityThreshold === "number") result.severityThreshold = obj.severityThreshold;

  if (typeof obj.mode === "string" && (VALID_MODES as string[]).includes(obj.mode)) {
    result.mode = obj.mode as HoneMode;
  }

  if (typeof obj.models === "object" && obj.models !== null && !Array.isArray(obj.models)) {
    const modelsObj = obj.models as Record<string, unknown>;
    const validatedModels: Partial<Record<typeof MODEL_FIELDS[number], string>> = {};
    for (const field of MODEL_FIELDS) {
      if (typeof modelsObj[field] === "string") {
        validatedModels[field] = modelsObj[field] as string;
      }
    }
    if (Object.keys(validatedModels).length > 0) {
      result.models = validatedModels as HoneConfig["models"];
    }
  }

  return result;
}

export async function loadConfig(configPath?: string): Promise<HoneConfig> {
  const defaults = getDefaultConfig();
  const resolvedPath = configPath ?? join(homedir(), ".config", "hone", "config.json");

  try {
    const file = Bun.file(resolvedPath);
    if (await file.exists()) {
      const raw = await file.json();
      const validated = validateUserConfig(raw);
      return {
        models: { ...defaults.models, ...validated.models },
        auditDir: validated.auditDir ?? defaults.auditDir,
        readOnlyTools: validated.readOnlyTools ?? defaults.readOnlyTools,
        maxRetries: validated.maxRetries ?? defaults.maxRetries,
        gateTimeout: validated.gateTimeout ?? defaults.gateTimeout,
        mode: validated.mode ?? defaults.mode,
        minCharterLength: validated.minCharterLength ?? defaults.minCharterLength,
        severityThreshold: validated.severityThreshold ?? defaults.severityThreshold,
      };
    }
  } catch {
    // Config file missing or invalid — use defaults
  }

  return defaults;
}
