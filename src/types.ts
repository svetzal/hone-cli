export interface ModelConfig {
  assess: string;
  name: string;
  plan: string;
  execute: string;
}

export interface GateDefinition {
  name: string;
  command: string;
  required: boolean;
}

export interface GateResult {
  name: string;
  command: string;
  passed: boolean;
  required: boolean;
  output: string;
  exitCode: number | null;
}

export interface GatesRunResult {
  allPassed: boolean;
  requiredPassed: boolean;
  results: GateResult[];
}

export interface StageOutput {
  stage: "assess" | "name" | "plan" | "execute";
  content: string;
}

export interface IterationResult {
  name: string;
  assessment: string;
  plan: string;
  execution: string;
  gatesResult: GatesRunResult | null;
  retries: number;
  success: boolean;
}

export interface HoneConfig {
  models: ModelConfig;
  auditDir: string;
  readOnlyTools: string;
  maxRetries: number;
  gateTimeout: number;
}

export interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

export type ClaudeInvoker = (args: string[]) => Promise<string>;
