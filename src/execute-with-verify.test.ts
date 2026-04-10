import { describe, expect, test } from "bun:test";
import { runExecuteWithVerify } from "./execute-with-verify.ts";
import { buildClaudeArgs } from "./claude.ts";
import { getDefaultConfig } from "./config.ts";
import { join } from "path";
import { mkdtemp, mkdir, rm } from "fs/promises";
import { tmpdir } from "os";
import type { GateDefinition, GatesRunResult, PipelineContext } from "./types.ts";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const requiredGates: GateDefinition[] = [
  { name: "test", command: "npm test", required: true },
];

const passingResult: GatesRunResult = {
  allPassed: true,
  requiredPassed: true,
  results: [
    { name: "test", command: "npm test", passed: true, required: true, output: "ok", exitCode: 0 },
  ],
};

const failingResult: GatesRunResult = {
  allPassed: false,
  requiredPassed: false,
  results: [
    { name: "test", command: "npm test", passed: false, required: true, output: "FAIL: error", exitCode: 1 },
  ],
};

function simpleClaude(response: string) {
  return async (_args: string[]) => response;
}

async function makeTempDirs(prefix: string) {
  const folder = await mkdtemp(join(tmpdir(), prefix));
  const auditDir = join(folder, "audit");
  await mkdir(auditDir, { recursive: true });
  return { folder, auditDir };
}

function makeCtx(folder: string, overrides: Partial<PipelineContext> = {}): PipelineContext {
  const config = getDefaultConfig();
  return {
    agent: "test-agent",
    folder,
    config,
    claude: simpleClaude("execution output"),
    onProgress: () => {},
    ...overrides,
  };
}

function baseOpts(
  auditDir: string,
  overrides: Partial<Parameters<typeof runExecuteWithVerify>[2]> = {},
): Parameters<typeof runExecuteWithVerify>[2] {
  return {
    skipGates: true,
    gateRunner: async () => passingResult,
    gates: requiredGates,
    auditDir,
    name: "test-fix",
    buildRetryPrompt: () => "retry prompt",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runExecuteWithVerify", () => {
  test("executes Claude with correct args and saves actions audit file", async () => {
    const { folder, auditDir } = await makeTempDirs("hone-evv-args-");

    let capturedArgs: string[] | null = null;
    const mockClaude = async (args: string[]) => {
      capturedArgs = args;
      return "execution output";
    };

    const ctx = makeCtx(folder, { claude: mockClaude });
    const prompt = "apply the fix";

    try {
      const result = await runExecuteWithVerify(ctx, prompt, baseOpts(auditDir));

      const expectedArgs = buildClaudeArgs({
        agent: "test-agent",
        model: ctx.config.models.execute,
        prompt,
        readOnly: false,
        readOnlyTools: ctx.config.readOnlyTools,
      });

      expect(capturedArgs!).toEqual(expectedArgs);
      expect(result.execution).toBe("execution output");
      expect(await Bun.file(join(auditDir, "test-fix-actions.md")).exists()).toBe(true);
    } finally {
      await rm(folder, { recursive: true });
    }
  });

  test("skipGates true — returns success: true, gatesResult: null, retries: 0", async () => {
    const { folder, auditDir } = await makeTempDirs("hone-evv-skipgates-");

    try {
      const result = await runExecuteWithVerify(
        makeCtx(folder),
        "apply the fix",
        baseOpts(auditDir, { skipGates: true }),
      );

      expect(result.success).toBe(true);
      expect(result.gatesResult).toBeNull();
      expect(result.retries).toBe(0);
    } finally {
      await rm(folder, { recursive: true });
    }
  });

  test("gates pass — returns success: true with requiredPassed: true and retries: 0", async () => {
    const { folder, auditDir } = await makeTempDirs("hone-evv-pass-");

    try {
      const result = await runExecuteWithVerify(
        makeCtx(folder),
        "apply the fix",
        baseOpts(auditDir, {
          skipGates: false,
          gateRunner: async () => passingResult,
        }),
      );

      expect(result.success).toBe(true);
      expect(result.gatesResult?.requiredPassed).toBe(true);
      expect(result.retries).toBe(0);
    } finally {
      await rm(folder, { recursive: true });
    }
  });

  test("required gates fail and retries exhausted — returns success: false", async () => {
    const { folder, auditDir } = await makeTempDirs("hone-evv-fail-");

    const config = { ...getDefaultConfig(), maxRetries: 1 };

    try {
      const result = await runExecuteWithVerify(
        makeCtx(folder, { config }),
        "apply the fix",
        baseOpts(auditDir, {
          skipGates: false,
          gateRunner: async () => failingResult,
        }),
      );

      expect(result.success).toBe(false);
      expect(result.retries).toBe(1);
      expect(result.gatesResult?.requiredPassed).toBe(false);
    } finally {
      await rm(folder, { recursive: true });
    }
  });

  test("retry succeeds on second attempt — returns success: true with retries: 1", async () => {
    const { folder, auditDir } = await makeTempDirs("hone-evv-retry-");

    let claudeCalls = 0;
    const mockClaude = async (_args: string[]) => {
      claudeCalls++;
      return claudeCalls === 1 ? "initial output" : "retry output";
    };

    let gateCalls = 0;
    const gateRunner = async (): Promise<GatesRunResult> => {
      gateCalls++;
      return gateCalls === 1 ? failingResult : passingResult;
    };

    try {
      const result = await runExecuteWithVerify(
        makeCtx(folder, { claude: mockClaude }),
        "apply the fix",
        baseOpts(auditDir, {
          skipGates: false,
          gateRunner,
        }),
      );

      expect(result.success).toBe(true);
      expect(result.retries).toBe(1);
      expect(result.execution).toBe("retry output");
    } finally {
      await rm(folder, { recursive: true });
    }
  });

  test("onProgress receives execute stage messages", async () => {
    const { folder, auditDir } = await makeTempDirs("hone-evv-progress-");

    const progressCalls: [string, string][] = [];
    const ctx = makeCtx(folder, {
      onProgress: (stage, message) => progressCalls.push([stage, message]),
    });

    try {
      await runExecuteWithVerify(
        ctx,
        "apply the fix",
        baseOpts(auditDir, {
          skipGates: false,
          gateRunner: async () => passingResult,
        }),
      );

      expect(progressCalls.some(([stage, msg]) => stage === "execute" && msg === "Executing plan...")).toBe(true);
      expect(progressCalls.some(([, msg]) => msg.includes("actions.md"))).toBe(true);
    } finally {
      await rm(folder, { recursive: true });
    }
  });
});
