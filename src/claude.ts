import { CliError } from "./errors.ts";
import { runProcess } from "./process.ts";
import { nextDepthEnv } from "./recursion-guard.ts";
import type { ClaudeContext, ClaudeInvoker, HoneConfig, ModelConfig, PipelineContext } from "./types.ts";

export interface ClaudeStageArgs {
  agent?: string;
  model: string;
  prompt: string;
  readOnly: boolean;
  readOnlyTools: string;
}

export function buildClaudeArgs(opts: ClaudeStageArgs): string[] {
  const args: string[] = [];

  if (opts.agent) {
    args.push("--agent", opts.agent);
  }

  args.push("--model", opts.model, "--print", "-p", opts.prompt);

  if (opts.readOnly) {
    args.push("--allowedTools", opts.readOnlyTools);
  }

  args.push("--dangerously-skip-permissions");

  return args;
}

export async function invokeClaude(args: string[], cwd?: string): Promise<string> {
  const env = nextDepthEnv(process.env);
  const { stdout, stderr, exitCode } = await runProcess(["claude", ...args], { cwd, env });

  if (exitCode !== 0) {
    throw new CliError(`claude exited with code ${exitCode}: ${stderr || stdout}`);
  }

  return stdout.trim();
}

export function createClaudeInvoker(opts?: { cwd?: string }): ClaudeInvoker {
  const cwd = opts?.cwd;
  return (args) => invokeClaude(args, cwd);
}

export async function invokeReadOnlyStage(
  ctx: ClaudeContext,
  prompt: string,
  opts?: { agent?: string },
): Promise<string> {
  return ctx.claude(
    buildClaudeArgs({ agent: opts?.agent, model: ctx.model, prompt, readOnly: true, readOnlyTools: ctx.readOnlyTools }),
  );
}

export async function invokeWriteStage(ctx: ClaudeContext, prompt: string, opts?: { agent?: string }): Promise<string> {
  return ctx.claude(
    buildClaudeArgs({
      agent: opts?.agent,
      model: ctx.model,
      prompt,
      readOnly: false,
      readOnlyTools: ctx.readOnlyTools,
    }),
  );
}

export function claudeCtx(ctx: PipelineContext, stage: keyof ModelConfig): ClaudeContext {
  return {
    model: ctx.config.models[stage],
    readOnlyTools: ctx.config.readOnlyTools,
    claude: ctx.claude,
  };
}

export function claudeCtxFromConfig(
  config: HoneConfig,
  stage: keyof ModelConfig,
  claude: ClaudeInvoker,
): ClaudeContext {
  return {
    model: config.models[stage],
    readOnlyTools: config.readOnlyTools,
    claude,
  };
}
