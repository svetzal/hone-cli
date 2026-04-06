import { describe, expect, test } from "bun:test";
import { verifyWithRetry } from "./verify-loop.ts";
import { getDefaultConfig } from "./config.ts";
import { join } from "path";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import type { GateDefinition, GatesRunResult, AttemptRecord, PipelineContext } from "./types.ts";

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

/** Creates a mock claude invoker that always returns the given string. */
function simpleClaude(response: string) {
  return async (_args: string[]) => response;
}

/** Creates a temp dir with an audit subdirectory. Returns { folder, auditDir }. */
async function makeTempDirs(prefix: string) {
  const folder = await mkdtemp(join(tmpdir(), prefix));
  const auditDir = join(folder, "audit");
  await mkdir(auditDir, { recursive: true });
  return { folder, auditDir };
}

/** Builds a PipelineContext for testing. */
function makeCtx(
  folder: string,
  overrides: Partial<PipelineContext> = {},
): PipelineContext {
  const config = getDefaultConfig();
  return {
    agent: "test-agent",
    folder,
    config,
    claude: simpleClaude("retry output"),
    onProgress: () => {},
    ...overrides,
  };
}

/** Builds base opts for verifyWithRetry with sensible defaults for testing. */
function baseOpts(
  folder: string,
  auditDir: string,
  overrides: Partial<Parameters<typeof verifyWithRetry>[1]> = {},
): Parameters<typeof verifyWithRetry>[1] {
  const config = getDefaultConfig();
  return {
    ctx: makeCtx(folder),
    gates: requiredGates,
    gateRunner: async () => passingResult,
    maxRetries: config.maxRetries,
    gateTimeout: config.gateTimeout,
    auditDir,
    name: "test-fix",
    buildRetryPrompt: () => "retry prompt",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("verifyWithRetry", () => {
  test("all gates pass on first attempt — retries: 0, original execution returned", async () => {
    const { folder, auditDir } = await makeTempDirs("hone-vl-pass-");

    try {
      const result = await verifyWithRetry("initial execution", baseOpts(folder, auditDir, {
        gateRunner: async () => passingResult,
      }));

      expect(result.retries).toBe(0);
      expect(result.gatesResult?.requiredPassed).toBe(true);
      expect(result.execution).toBe("initial execution");
    } finally {
      await rm(folder, { recursive: true });
    }
  });

  test("required gate fails then succeeds — retries: 1, retry execution returned", async () => {
    const { folder, auditDir } = await makeTempDirs("hone-vl-retry-");

    let calls = 0;
    const gateRunner = async (): Promise<GatesRunResult> => {
      calls++;
      return calls === 1 ? failingResult : passingResult;
    };

    try {
      const result = await verifyWithRetry("initial execution", baseOpts(folder, auditDir, {
        ctx: makeCtx(folder, { claude: simpleClaude("retry execution") }),
        gateRunner,
        maxRetries: 3,
      }));

      expect(result.retries).toBe(1);
      expect(result.gatesResult?.requiredPassed).toBe(true);
      expect(result.execution).toBe("retry execution");
    } finally {
      await rm(folder, { recursive: true });
    }
  });

  test("max retries exhausted — retries equals maxRetries, requiredPassed false", async () => {
    const { folder, auditDir } = await makeTempDirs("hone-vl-exhaust-");

    try {
      const result = await verifyWithRetry("initial execution", baseOpts(folder, auditDir, {
        gateRunner: async () => failingResult,
        maxRetries: 2,
      }));

      expect(result.retries).toBe(2);
      expect(result.gatesResult?.requiredPassed).toBe(false);
    } finally {
      await rm(folder, { recursive: true });
    }
  });

  test("empty gates emits 'No quality gates found' progress message", async () => {
    const { folder, auditDir } = await makeTempDirs("hone-vl-nogates-");

    const messages: string[] = [];

    try {
      const result = await verifyWithRetry("initial execution", baseOpts(folder, auditDir, {
        ctx: makeCtx(folder, { onProgress: (_stage, msg) => messages.push(msg) }),
        gates: [],
        gateRunner: async () => passingResult,
      }));

      expect(messages).toContain("No quality gates found.");
      expect(result.gatesResult?.requiredPassed).toBe(true);
    } finally {
      await rm(folder, { recursive: true });
    }
  });

  test("retry prompt builder receives cumulative prior attempts on second retry", async () => {
    const { folder, auditDir } = await makeTempDirs("hone-vl-cumulative-");

    const promptBuilderCalls: Array<{ failedGates: { name: string; output: string }[]; priorAttempts: AttemptRecord[] }> = [];

    let calls = 0;
    const gateRunner = async (): Promise<GatesRunResult> => {
      calls++;
      // Fail first two, pass third
      return calls <= 2 ? failingResult : passingResult;
    };

    try {
      await verifyWithRetry("initial execution", baseOpts(folder, auditDir, {
        gateRunner,
        maxRetries: 3,
        buildRetryPrompt: (failedGates, priorAttempts) => {
          promptBuilderCalls.push({ failedGates, priorAttempts });
          return "retry prompt";
        },
      }));

      // Two retries were needed before gates passed
      expect(promptBuilderCalls.length).toBe(2);

      // First retry: no prior attempts
      expect(promptBuilderCalls[0]!.priorAttempts).toHaveLength(0);
      expect(promptBuilderCalls[0]!.failedGates).toEqual([{ name: "test", output: "FAIL: error" }]);

      // Second retry: one prior attempt recorded
      expect(promptBuilderCalls[1]!.priorAttempts).toHaveLength(1);
      expect(promptBuilderCalls[1]!.priorAttempts[0]!.attempt).toBe(1);
    } finally {
      await rm(folder, { recursive: true });
    }
  });

  test(".hone-gates.json in folder overrides opts.gates passed to gateRunner", async () => {
    const { folder, auditDir } = await makeTempDirs("hone-vl-override-");

    const overrideGates: GateDefinition[] = [
      { name: "override-test", command: "bun test", required: true },
    ];

    await writeFile(
      join(folder, ".hone-gates.json"),
      JSON.stringify({ gates: overrideGates }),
    );

    const capturedGates: GateDefinition[][] = [];

    try {
      await verifyWithRetry("initial execution", baseOpts(folder, auditDir, {
        gates: requiredGates, // different from overrideGates
        gateRunner: async (gates) => {
          capturedGates.push(gates);
          return passingResult;
        },
      }));

      expect(capturedGates.length).toBe(1);
      expect(capturedGates[0]).toEqual(overrideGates);
    } finally {
      await rm(folder, { recursive: true });
    }
  });

  test("retry audit files saved for each retry attempt", async () => {
    const { folder, auditDir } = await makeTempDirs("hone-vl-audit-");

    let calls = 0;
    const gateRunner = async (): Promise<GatesRunResult> => {
      calls++;
      return calls <= 2 ? failingResult : passingResult;
    };

    try {
      await verifyWithRetry("initial execution", baseOpts(folder, auditDir, {
        name: "my-fix",
        gateRunner,
        maxRetries: 3,
      }));

      expect(await Bun.file(join(auditDir, "my-fix-retry-1-actions.md")).exists()).toBe(true);
      expect(await Bun.file(join(auditDir, "my-fix-retry-2-actions.md")).exists()).toBe(true);
      expect(await Bun.file(join(auditDir, "my-fix-retry-3-actions.md")).exists()).toBe(false);
    } finally {
      await rm(folder, { recursive: true });
    }
  });

  test("only required gate failures trigger retry — optional gate failure does not", async () => {
    const { folder, auditDir } = await makeTempDirs("hone-vl-optional-");

    const optionalFailResult: GatesRunResult = {
      allPassed: false,
      requiredPassed: true,
      results: [
        { name: "security", command: "npm audit", passed: false, required: false, output: "2 vulns", exitCode: 1 },
      ],
    };

    let gateRunnerCallCount = 0;

    try {
      const result = await verifyWithRetry("initial execution", baseOpts(folder, auditDir, {
        gateRunner: async () => {
          gateRunnerCallCount++;
          return optionalFailResult;
        },
        maxRetries: 3,
      }));

      expect(result.retries).toBe(0);
      expect(result.gatesResult?.requiredPassed).toBe(true);
      expect(gateRunnerCallCount).toBe(1); // Only one call — loop broke on requiredPassed
    } finally {
      await rm(folder, { recursive: true });
    }
  });
});
