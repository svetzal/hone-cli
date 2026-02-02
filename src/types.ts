export interface ModelConfig {
  assess: string;
  name: string;
  plan: string;
  execute: string;
  gates: string;
  derive: string;
  triage: string;
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
  structuredAssessment: StructuredAssessment | null;
  triageResult: TriageResult | null;
  charterCheck: CharterCheckResult | null;
  skippedReason: string | null;
}

export type HoneMode = "local" | "github";

export interface HoneConfig {
  models: ModelConfig;
  auditDir: string;
  readOnlyTools: string;
  maxRetries: number;
  gateTimeout: number;
  mode: HoneMode;
  minCharterLength: number;
  severityThreshold: number;
}

export interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

export type ClaudeInvoker = (args: string[]) => Promise<string>;

export type GateRunner = (gates: GateDefinition[], projectDir: string, timeout: number) => Promise<GatesRunResult>;

export type GateResolverFn = (
  projectDir: string,
  agentName: string,
  model: string,
  readOnlyTools: string,
  claude: ClaudeInvoker,
) => Promise<GateDefinition[]>;

export type CharterCheckerFn = (
  projectDir: string,
  minLength: number,
) => Promise<CharterCheckResult>;

export type TriageRunnerFn = (
  assessment: StructuredAssessment,
  threshold: number,
  model: string,
  tools: string,
  claude: ClaudeInvoker,
) => Promise<TriageResult>;

// Charter check types
export interface CharterSource {
  file: string;
  length: number;
  sufficient: boolean;
}

export interface CharterCheckResult {
  passed: boolean;
  sources: CharterSource[];
  guidance: string[];
}

// Structured assessment types
export interface StructuredAssessment {
  severity: number;
  principle: string;
  category: string;
  prose: string;
  raw: string;
}

// Triage types
export interface TriageResult {
  accepted: boolean;
  reason: string;
  severity: number;
  changeType: string;
  busyWork: boolean;
}

// GitHub mode types
export interface HoneIssue {
  number: number;
  title: string;
  body: string;
  reactions: { thumbsUp: string[]; thumbsDown: string[] };
  createdAt: string;
}

export interface HoneProposal {
  name: string;
  assessment: string;
  plan: string;
  agent: string;
  severity: number;
  principle: string;
}

export interface ExecutionOutcome {
  issueNumber: number;
  success: boolean;
  commitHash: string | null;
  gatesResult: GatesRunResult | null;
  retries: number;
  error?: string;
}

export interface GitHubIterateResult {
  mode: "github";
  housekeeping: { closed: number[] };
  executed: ExecutionOutcome[];
  proposed: number[];
  skippedTriage: number;
}

export type CommandRunner = (
  command: string,
  args: string[],
  opts?: { cwd?: string },
) => Promise<{ stdout: string; exitCode: number }>;
