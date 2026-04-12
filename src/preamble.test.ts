import { describe, expect, test } from "bun:test";
import { getDefaultConfig } from "./config.ts";
import { runPreamble } from "./preamble.ts";
import {
  emptyGateResolver,
  failingCharterChecker,
  passingCharterChecker,
  standardGateResolver,
} from "./test-helpers.ts";
import type { GateDefinition, GatesRunResult, PipelineContext } from "./types.ts";

function makeCtx(
  onProgress: PipelineContext["onProgress"] = () => {},
  claude: PipelineContext["claude"] = async () => "",
): PipelineContext {
  return {
    agent: "test-agent",
    folder: "/test",
    config: getDefaultConfig(),
    claude,
    onProgress,
  };
}

describe("runPreamble", () => {
  test("charter check skipped: returns passed with null charter check", async () => {
    const progress: string[] = [];
    let charterCheckerCalled = false;

    const mockCharterChecker = async () => {
      charterCheckerCalled = true;
      return { passed: false, sources: [], guidance: [], warnings: [] };
    };

    const result = await runPreamble({
      ctx: makeCtx((stage, msg) => progress.push(`${stage}: ${msg}`)),
      skipCharter: true, // Skip charter check
      skipGates: true,
      gateResolver: emptyGateResolver,
      gateRunner: async () => ({ allPassed: true, requiredPassed: true, results: [] }),
      charterChecker: mockCharterChecker,
    });

    expect(result.passed).toBe(true);
    expect(result.charterCheck).toBeNull();
    expect(result.gates).toEqual([]);
    expect(charterCheckerCalled).toBe(false);
    // Should not see charter-related progress messages
    expect(progress.filter((p) => p.startsWith("charter:"))).toEqual([]);
  });

  test("charter check passes: returns passed with charter check result", async () => {
    const progress: string[] = [];

    const result = await runPreamble({
      ctx: makeCtx((stage, msg) => progress.push(`${stage}: ${msg}`)),
      skipCharter: false,
      skipGates: true,
      gateResolver: emptyGateResolver,
      gateRunner: async () => ({ allPassed: true, requiredPassed: true, results: [] }),
      charterChecker: passingCharterChecker,
    });

    expect(result.passed).toBe(true);
    expect(result.charterCheck).not.toBeNull();
    expect(result.charterCheck?.passed).toBe(true);
    expect(result.gates).toEqual([]);

    // Should see charter progress messages
    expect(progress).toContain("charter: Checking project charter clarity...");
    expect(progress).toContain("charter: Charter check passed.");
  });

  test("charter check fails: returns failed with guidance and does not run gates", async () => {
    const progress: string[] = [];
    let gateResolverCalled = false;

    const mockGateResolver = async () => {
      gateResolverCalled = true;
      return [] as GateDefinition[];
    };

    const result = await runPreamble({
      ctx: makeCtx((stage, msg) => progress.push(`${stage}: ${msg}`)),
      skipCharter: false,
      skipGates: false, // Gates NOT skipped, but should not run
      gateResolver: mockGateResolver,
      gateRunner: async () => ({ allPassed: true, requiredPassed: true, results: [] }),
      charterChecker: failingCharterChecker,
    });

    expect(result.passed).toBe(false);
    if (result.passed) throw new Error("Expected failure");

    expect(result.failureStage).toBe("charter");
    expect(result.failureReason).toBe("Charter clarity insufficient");
    expect(result.charterCheck?.passed).toBe(false);
    expect(result.gates).toEqual([]);

    // Gate resolver should NOT have been called (early exit)
    expect(gateResolverCalled).toBe(false);

    // Should see charter failure messages
    expect(progress).toContain("charter: Checking project charter clarity...");
    expect(progress).toContain("charter: Charter clarity insufficient.");
    expect(progress).toContain("charter:   → Add a CHARTER.md describing the project's goals");
  });

  test("preflight skipped: returns passed with empty gates", async () => {
    const progress: string[] = [];
    let gateResolverCalled = false;

    const mockGateResolver = async () => {
      gateResolverCalled = true;
      return [] as GateDefinition[];
    };

    const result = await runPreamble({
      ctx: makeCtx((stage, msg) => progress.push(`${stage}: ${msg}`)),
      skipCharter: true,
      skipGates: true, // Skip gates
      gateResolver: mockGateResolver,
      gateRunner: async () => ({ allPassed: true, requiredPassed: true, results: [] }),
      charterChecker: passingCharterChecker,
    });

    expect(result.passed).toBe(true);
    expect(result.gates).toEqual([]);
    expect(gateResolverCalled).toBe(false);
    // Should not see preflight-related progress messages
    expect(progress.filter((p) => p.startsWith("preflight:"))).toEqual([]);
  });

  test("preflight passes with no gates resolved: returns passed", async () => {
    const progress: string[] = [];
    let gateRunnerCalled = false;

    const mockGateRunner = async () => {
      gateRunnerCalled = true;
      return { allPassed: true, requiredPassed: true, results: [] };
    };

    const result = await runPreamble({
      ctx: makeCtx((stage, msg) => progress.push(`${stage}: ${msg}`)),
      skipCharter: true,
      skipGates: false,
      gateResolver: emptyGateResolver, // Returns empty array
      gateRunner: mockGateRunner,
      charterChecker: passingCharterChecker,
    });

    expect(result.passed).toBe(true);
    expect(result.gates).toEqual([]);
    // Gate runner should NOT be called when no gates are resolved
    expect(gateRunnerCalled).toBe(false);

    // Should see gate resolution progress but not running
    expect(progress).toContain("preflight: Resolving quality gates...");
    expect(progress.filter((p) => p.includes("Running preflight"))).toEqual([]);
  });

  test("preflight passes with gates: returns passed with gates", async () => {
    const progress: string[] = [];
    let gateRunnerCalls = 0;

    const mockGateRunner = async () => {
      gateRunnerCalls++;
      return {
        allPassed: true,
        requiredPassed: true,
        results: [
          {
            name: "test",
            command: "npm test",
            passed: true,
            required: true,
            output: "All tests passed",
            exitCode: 0,
          },
        ],
      };
    };

    const result = await runPreamble({
      ctx: makeCtx((stage, msg) => progress.push(`${stage}: ${msg}`)),
      skipCharter: true,
      skipGates: false,
      gateResolver: standardGateResolver, // Returns one gate
      gateRunner: mockGateRunner,
      charterChecker: passingCharterChecker,
    });

    expect(result.passed).toBe(true);
    expect(result.gates).toHaveLength(1);
    expect(result.gates[0]?.name).toBe("test");
    expect(gateRunnerCalls).toBe(1);

    // Should see full preflight progress
    expect(progress).toContain("preflight: Resolving quality gates...");
    expect(progress).toContain("preflight: Running preflight gate check on unmodified codebase...");
    expect(progress).toContain("preflight: Preflight passed.");
  });

  test("preflight fails: returns failed with gate results", async () => {
    const progress: string[] = [];

    const mockGateRunner = async (): Promise<GatesRunResult> => ({
      allPassed: false,
      requiredPassed: false,
      results: [
        {
          name: "test",
          command: "npm test",
          passed: false,
          required: true,
          output: "Test suite failed",
          exitCode: 1,
        },
      ],
    });

    const result = await runPreamble({
      ctx: makeCtx((stage, msg) => progress.push(`${stage}: ${msg}`)),
      skipCharter: true,
      skipGates: false,
      gateResolver: standardGateResolver,
      gateRunner: mockGateRunner,
      charterChecker: passingCharterChecker,
    });

    expect(result.passed).toBe(false);
    if (result.passed) throw new Error("Expected failure");

    expect(result.failureStage).toBe("preflight");
    expect(result.failureReason).toBe("Preflight failed: required gates do not pass on unmodified codebase");
    expect(result.gates).toHaveLength(1);
    expect(result.gatesResult).not.toBeUndefined();
    expect(result.gatesResult?.requiredPassed).toBe(false);

    // Should see preflight failure message
    expect(progress).toContain("preflight: Resolving quality gates...");
    expect(progress).toContain("preflight: Running preflight gate check on unmodified codebase...");
    expect(progress).toContain("preflight: Preflight failed: required gates do not pass on unmodified codebase.");
  });

  test("charter passes, then preflight fails: includes charter result in failure", async () => {
    const progress: string[] = [];

    const mockGateRunner = async (): Promise<GatesRunResult> => ({
      allPassed: false,
      requiredPassed: false,
      results: [],
    });

    const result = await runPreamble({
      ctx: makeCtx((stage, msg) => progress.push(`${stage}: ${msg}`)),
      skipCharter: false, // Charter check runs
      skipGates: false,
      gateResolver: standardGateResolver,
      gateRunner: mockGateRunner,
      charterChecker: passingCharterChecker,
    });

    expect(result.passed).toBe(false);
    if (result.passed) throw new Error("Expected failure");

    expect(result.failureStage).toBe("preflight");
    expect(result.charterCheck).not.toBeNull();
    expect(result.charterCheck?.passed).toBe(true);

    // Should see both charter and preflight messages
    expect(progress.filter((p) => p.startsWith("charter:"))).toHaveLength(2); // "Checking..." and "passed."
    expect(progress.filter((p) => p.startsWith("preflight:"))).toHaveLength(3); // "Resolving...", "Running...", "failed."
  });

  test("progress messages are called in correct order", async () => {
    const progress: string[] = [];

    const result = await runPreamble({
      ctx: makeCtx((stage, msg) => progress.push(`${stage}: ${msg}`)),
      skipCharter: false,
      skipGates: false,
      gateResolver: standardGateResolver,
      gateRunner: async () => ({ allPassed: true, requiredPassed: true, results: [] }),
      charterChecker: passingCharterChecker,
    });

    expect(result.passed).toBe(true);

    // Verify message order
    expect(progress[0]).toBe("charter: Checking project charter clarity...");
    expect(progress[1]).toBe("charter: Charter check passed.");
    expect(progress[2]).toBe("preflight: Resolving quality gates...");
    expect(progress[3]).toBe("preflight: Running preflight gate check on unmodified codebase...");
    expect(progress[4]).toBe("preflight: Preflight passed.");
  });
});
