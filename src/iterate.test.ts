import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDefaultConfig } from "./config.ts";
import { buildRetryPrompt, iterate, sanitizeName } from "./iterate.ts";
import {
  acceptingTriageRunner,
  createIterateMock,
  createPreflightAwareGateRunner,
  emptyGateResolver,
  extractPrompt,
  failingCharterChecker,
  passingCharterChecker,
  rejectingBusyWorkTriageRunner,
  rejectingSeverityTriageRunner,
  standardGateResolver,
} from "./test-helpers.ts";
import type { GateDefinition, GatesRunResult, PipelineContext } from "./types.ts";

function makeCtx(
  dir: string,
  claude: PipelineContext["claude"],
  onProgress: PipelineContext["onProgress"] = () => {},
): PipelineContext {
  return {
    agent: "test-agent",
    folder: dir,
    config: getDefaultConfig(),
    claude,
    onProgress,
  };
}

describe("iterate", () => {
  test("runs full cycle with mock claude invoker", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-iter-"));
    const calls: string[][] = [];

    const mockClaude = createIterateMock(
      {
        assess: "The project violates the single responsibility principle.",
        name: "fix-srp-violation",
        plan: "Step 1: Extract class\nStep 2: Move methods",
        execute: "Extracted UserAuth class into its own module.",
        summarize:
          '```json\n{ "headline": "Fix SRP violation in auth module", "summary": "Extracted UserAuth class." }\n```',
      },
      { onCall: (args) => calls.push(args) },
    );

    try {
      const progress: string[] = [];
      const result = await iterate({
        ctx: makeCtx(dir, mockClaude, (stage, msg) => progress.push(`${stage}: ${msg}`)),
        skipGates: true,
        skipCharter: true,
        skipTriage: true,
      });

      expect(result.kind).toBe("completed");
      if (result.kind !== "completed") throw new Error("unreachable");
      expect(result.name).toBe("fix-srp-violation");
      expect(result.assessment).toContain("single responsibility");
      expect(result.plan).toContain("Extract class");
      expect(result.execution).toContain("UserAuth");
      expect(result.success).toBe(true);
      expect(result.retries).toBe(0);
      expect(result.headline).toBe("Fix SRP violation in auth module");
      expect(result.summary).toBe("Extracted UserAuth class.");

      // 5 claude calls: assess, name, plan, execute, summarize
      expect(calls.length).toBe(5);

      // Verify read-only stages use --allowedTools
      expect(calls[0]).toContain("--allowedTools");
      expect(calls[1]).toContain("--allowedTools");
      expect(calls[2]).toContain("--allowedTools");
      // Execute stage does NOT have --allowedTools
      expect(calls[3]).not.toContain("--allowedTools");
      // Summarize stage uses --allowedTools
      expect(calls[4]).toContain("--allowedTools");

      // Verify audit files were created
      const auditDir = join(dir, "audit");
      expect(await Bun.file(join(auditDir, "fix-srp-violation.md")).exists()).toBe(true);
      expect(await Bun.file(join(auditDir, "fix-srp-violation-plan.md")).exists()).toBe(true);
      expect(await Bun.file(join(auditDir, "fix-srp-violation-actions.md")).exists()).toBe(true);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("falls back to timestamp name when sanitization fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-iter-"));

    const mockClaude = createIterateMock({
      assess: "assessment",
      name: "!!!---!!!",
      plan: "plan",
      execute: "done",
    });

    try {
      const result = await iterate({
        ctx: makeCtx(dir, mockClaude),
        skipGates: true,
        skipCharter: true,
        skipTriage: true,
      });

      // Should fall back to assessment-<timestamp>
      expect(result.name).toMatch(/^assessment-\d+$/);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("gates pass on first attempt — no retries, success", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-iter-"));

    const claudeCalls: string[][] = [];
    const mockClaude = createIterateMock(
      {
        assess: "Assessment content",
        name: "test-issue-name",
        plan: "Plan content",
        execute: "Execution content",
      },
      { onCall: (args) => claudeCalls.push(args) },
    );

    const gateRunnerCalls: Array<[GateDefinition[], string, number]> = [];
    const mockGateRunner = async (
      gates: GateDefinition[],
      projectDir: string,
      timeout: number,
    ): Promise<GatesRunResult> => {
      gateRunnerCalls.push([gates, projectDir, timeout]);
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

    try {
      const result = await iterate({
        ctx: makeCtx(dir, mockClaude),
        skipGates: false,
        skipCharter: true,
        skipTriage: true,
        gateRunner: mockGateRunner,
        gateResolver: standardGateResolver,
      });

      expect(result.kind).toBe("completed");
      if (result.kind !== "completed") throw new Error("unreachable");
      expect(result.success).toBe(true);
      expect(result.retries).toBe(0);
      expect(result.gatesResult?.requiredPassed).toBe(true);

      // Should have exactly 5 claude calls (4 stages + summarize)
      expect(claudeCalls.length).toBe(5);

      // Should have exactly 2 gate runner calls (preflight + verify)
      expect(gateRunnerCalls.length).toBe(2);

      // Gate runner should receive the resolved gates
      expect(gateRunnerCalls[0]?.[0]).toEqual([{ name: "test", command: "npm test", required: true }]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("required gate fails, retry succeeds — 1 retry, success", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-iter-"));

    const claudeCalls: string[][] = [];
    const mockClaude = createIterateMock(
      {
        assess: "Assessment content",
        name: "test-issue-name",
        plan: "Plan content",
        execute: "Execution content",
      },
      { onCall: (args) => claudeCalls.push(args) },
    );

    const { runner: mockGateRunner, callCount } = createPreflightAwareGateRunner([
      // First post-preflight call (verify after execute) — fail
      {
        allPassed: false,
        requiredPassed: false,
        results: [
          {
            name: "test",
            command: "npm test",
            passed: false,
            required: true,
            output: "FAIL: 1 test failed",
            exitCode: 1,
          },
        ],
      },
      // Second post-preflight call (verify after retry) — pass
      {
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
      },
    ]);

    try {
      const result = await iterate({
        ctx: makeCtx(dir, mockClaude),
        skipGates: false,
        skipCharter: true,
        skipTriage: true,
        gateRunner: mockGateRunner,
        gateResolver: standardGateResolver,
      });

      expect(result.kind).toBe("completed");
      if (result.kind !== "completed") throw new Error("unreachable");
      expect(result.success).toBe(true);
      expect(result.retries).toBe(1);

      // Should have 6 claude calls (4 stages + 1 retry + summarize)
      expect(claudeCalls.length).toBe(6);

      // Should have 3 gate runner calls (preflight + verify fail + verify pass)
      expect(callCount()).toBe(3);

      // Verify retry actions file was saved
      const auditDir = join(dir, "audit");
      expect(await Bun.file(join(auditDir, "test-issue-name-retry-1-actions.md")).exists()).toBe(true);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("required gate fails, max retries exhausted — failure", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-iter-"));

    const claudeCalls: string[][] = [];
    const mockClaude = createIterateMock(
      {
        assess: "Assessment content",
        name: "test-issue-name",
        plan: "Plan content",
        execute: "Execution content",
      },
      { onCall: (args) => claudeCalls.push(args) },
    );

    const alwaysFailResult: GatesRunResult = {
      allPassed: false,
      requiredPassed: false,
      results: [
        {
          name: "test",
          command: "npm test",
          passed: false,
          required: true,
          output: "FAIL: persistent error",
          exitCode: 1,
        },
      ],
    };

    const { runner: mockGateRunner, callCount } = createPreflightAwareGateRunner([alwaysFailResult]);

    try {
      const config = getDefaultConfig();
      config.maxRetries = 2;

      const result = await iterate({
        ctx: { ...makeCtx(dir, mockClaude), config },
        skipGates: false,
        skipCharter: true,
        skipTriage: true,
        gateRunner: mockGateRunner,
        gateResolver: standardGateResolver,
      });

      expect(result.kind).toBe("completed");
      if (result.kind !== "completed") throw new Error("unreachable");
      expect(result.success).toBe(false);
      expect(result.retries).toBe(2);
      expect(result.headline).toBeNull();
      expect(result.summary).toBeNull();

      // Should have 6 claude calls (4 stages + 2 retries)
      expect(claudeCalls.length).toBe(6);

      // Should have 4 gate runner calls (preflight + initial + 2 retries)
      expect(callCount()).toBe(4);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("optional gate fails — no retry triggered, still success", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-iter-"));

    const claudeCalls: string[][] = [];
    const mockClaude = createIterateMock(
      {
        assess: "Assessment content",
        name: "test-issue-name",
        plan: "Plan content",
        execute: "Execution content",
      },
      { onCall: (args) => claudeCalls.push(args) },
    );

    let gateRunCallCount = 0;
    const mockGateRunner = async (): Promise<GatesRunResult> => {
      gateRunCallCount++;
      return {
        allPassed: false,
        requiredPassed: true,
        results: [
          {
            name: "security",
            command: "npm audit",
            passed: false,
            required: false,
            output: "2 moderate vulnerabilities",
            exitCode: 1,
          },
        ],
      };
    };

    try {
      const result = await iterate({
        ctx: makeCtx(dir, mockClaude),
        skipGates: false,
        skipCharter: true,
        skipTriage: true,
        gateRunner: mockGateRunner,
        gateResolver: standardGateResolver,
      });

      expect(result.kind).toBe("completed");
      if (result.kind !== "completed") throw new Error("unreachable");
      expect(result.success).toBe(true);
      expect(result.retries).toBe(0);
      expect(result.gatesResult?.allPassed).toBe(false);
      expect(result.gatesResult?.requiredPassed).toBe(true);

      // Should have exactly 5 claude calls (4 stages + summarize)
      expect(claudeCalls.length).toBe(5);

      // Should have exactly 2 gate runner calls (preflight + verify)
      expect(gateRunCallCount).toBe(2);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("retry prompt contains original plan and failure output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-iter-"));

    const claudeCalls: string[][] = [];
    const mockClaude = createIterateMock(
      {
        assess: "Assessment content",
        name: "test-issue-name",
        plan: "Plan with specific steps",
        execute: "Execution content",
      },
      { onCall: (args) => claudeCalls.push(args) },
    );

    const { runner: mockGateRunner } = createPreflightAwareGateRunner([
      // First post-preflight call — fail
      {
        allPassed: false,
        requiredPassed: false,
        results: [
          {
            name: "test",
            command: "npm test",
            passed: false,
            required: true,
            output: "FAIL: expected 1 got 2",
            exitCode: 1,
          },
        ],
      },
      // Second post-preflight call — pass
      {
        allPassed: true,
        requiredPassed: true,
        results: [{ name: "test", command: "npm test", passed: true, required: true, output: "ok", exitCode: 0 }],
      },
    ]);

    try {
      await iterate({
        ctx: makeCtx(dir, mockClaude),
        skipGates: false,
        skipCharter: true,
        skipTriage: true,
        gateRunner: mockGateRunner,
        gateResolver: standardGateResolver,
      });

      // Capture the retry prompt (5th call); 6th is summarize
      expect(claudeCalls.length).toBe(6);
      // biome-ignore lint/style/noNonNullAssertion: length assertion above guarantees index 4 exists
      const retryPrompt = extractPrompt(claudeCalls[4]!);

      // Assert prompt contains original plan
      expect(retryPrompt).toContain("## Original Plan");
      expect(retryPrompt).toContain("Plan with specific steps");

      // Assert prompt contains failed gates section
      expect(retryPrompt).toContain("## Current Failed Gates");
      expect(retryPrompt).toContain("### Gate: test");
      expect(retryPrompt).toContain("FAIL: expected 1 got 2");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // --- Preflight tests ---

  test("preflight fails → early return, no Claude calls", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-iter-"));
    const calls: string[][] = [];

    const mockClaude = createIterateMock(
      { assess: "x", name: "x", plan: "x", execute: "x" },
      { onCall: (args) => calls.push(args) },
    );

    const failingGateRunner = async (): Promise<GatesRunResult> => ({
      allPassed: false,
      requiredPassed: false,
      results: [
        {
          name: "test",
          command: "npm test",
          passed: false,
          required: true,
          output: "FAIL: compilation error",
          exitCode: 1,
        },
      ],
    });

    try {
      const result = await iterate({
        ctx: makeCtx(dir, mockClaude),
        skipGates: false,
        skipCharter: true,
        skipTriage: true,
        gateRunner: failingGateRunner,
        gateResolver: standardGateResolver,
      });

      expect(result.kind).toBe("skipped");
      if (result.kind !== "skipped") throw new Error("unreachable");
      expect(result.success).toBe(false);
      expect(result.skippedReason).toContain("Preflight failed");
      expect(result.gatesResult?.requiredPassed).toBe(false);
      expect(calls.length).toBe(0); // No Claude calls made
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("no gates resolved → preflight skipped, pipeline continues", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-iter-"));
    const calls: string[][] = [];

    const mockClaude = createIterateMock(
      { assess: "Assessment", name: "test-name", plan: "Plan", execute: "Done" },
      { onCall: (args) => calls.push(args) },
    );

    let gateRunnerCallCount = 0;
    const mockGateRunner = async (): Promise<GatesRunResult> => {
      gateRunnerCallCount++;
      return { allPassed: true, requiredPassed: true, results: [] };
    };

    try {
      const result = await iterate({
        ctx: makeCtx(dir, mockClaude),
        skipGates: false,
        skipCharter: true,
        skipTriage: true,
        gateRunner: mockGateRunner,
        gateResolver: emptyGateResolver,
      });

      expect(result.success).toBe(true);
      // 5 claude calls: assess, name, plan, execute, summarize
      expect(calls.length).toBe(5);
      // Gate runner called once for verify (no preflight since no gates resolved)
      expect(gateRunnerCallCount).toBe(1);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  // --- Charter + Triage integration tests ---

  test("charter fails → early return, no Claude calls", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-iter-"));
    const calls: string[][] = [];

    const mockClaude = createIterateMock(
      { assess: "x", name: "x", plan: "x", execute: "x" },
      { onCall: (args) => calls.push(args) },
    );

    try {
      const result = await iterate({
        ctx: makeCtx(dir, mockClaude),
        skipGates: true,
        charterChecker: failingCharterChecker,
      });

      expect(result.kind).toBe("skipped");
      if (result.kind !== "skipped") throw new Error("unreachable");
      expect(result.success).toBe(false);
      expect(result.skippedReason).toBe("Charter clarity insufficient");
      expect(result.charterCheck?.passed).toBe(false);
      expect(calls.length).toBe(0); // No Claude calls made
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("triage rejects (low severity) → assess + name calls only", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-iter-"));
    const calls: string[][] = [];

    const mockClaude = createIterateMock(
      {
        assess: '```json\n{ "severity": 1, "principle": "DRY", "category": "duplication" }\n```\nMinor duplication.',
        name: "minor-duplication",
        plan: "should not be called",
        execute: "should not be called",
      },
      { onCall: (args) => calls.push(args) },
    );

    try {
      const result = await iterate({
        ctx: makeCtx(dir, mockClaude),
        skipGates: true,
        skipCharter: true,
        triageRunner: rejectingSeverityTriageRunner,
      });

      expect(result.kind).toBe("skipped");
      if (result.kind !== "skipped") throw new Error("unreachable");
      expect(result.success).toBe(true); // Triage rejection is a success state
      expect(result.skippedReason).toContain("Triage:");
      expect(result.triageResult?.accepted).toBe(false);
      expect(result.name).toBe("minor-duplication");
      // Only assess + name calls (2 total)
      expect(calls.length).toBe(2);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("triage rejects (busy-work) → assess + name calls only, no plan/execute", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-iter-"));
    const calls: string[][] = [];

    const mockClaude = createIterateMock(
      {
        assess: '```json\n{ "severity": 4, "principle": "Docs", "category": "documentation" }\n```\nNeeds docs.',
        name: "add-docs",
        plan: "should not be called",
        execute: "should not be called",
      },
      { onCall: (args) => calls.push(args) },
    );

    try {
      const result = await iterate({
        ctx: makeCtx(dir, mockClaude),
        skipGates: true,
        skipCharter: true,
        triageRunner: rejectingBusyWorkTriageRunner,
      });

      expect(result.kind).toBe("skipped");
      if (result.kind !== "skipped") throw new Error("unreachable");
      expect(result.success).toBe(true);
      expect(result.skippedReason).toContain("Busy-work");
      expect(result.triageResult?.busyWork).toBe(true);
      // Only assess + name calls (2 total)
      expect(calls.length).toBe(2);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("full pipeline with triage pass → assess + name + plan + execute", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-iter-"));
    const calls: string[][] = [];

    const mockClaude = createIterateMock(
      {
        assess: '```json\n{ "severity": 4, "principle": "SRP", "category": "architecture" }\n```\nViolation.',
        name: "fix-srp",
        plan: "Step 1: Extract",
        execute: "Done",
      },
      { onCall: (args) => calls.push(args) },
    );

    try {
      const result = await iterate({
        ctx: makeCtx(dir, mockClaude),
        skipGates: true,
        charterChecker: passingCharterChecker,
        triageRunner: acceptingTriageRunner,
      });

      expect(result.success).toBe(true);
      expect(result.kind).toBe("completed");
      expect(result.structuredAssessment).not.toBeNull();
      expect(result.triageResult?.accepted).toBe(true);
      expect(result.charterCheck?.passed).toBe(true);
      // 5 claude calls: assess, name, plan, execute, summarize
      expect(calls.length).toBe(5);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("skipCharter: true → charter checker not called", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-iter-"));
    let charterCalled = false;

    const mockClaude = createIterateMock({
      assess: "assessment",
      name: "test-name",
      plan: "plan",
      execute: "done",
    });

    try {
      await iterate({
        ctx: makeCtx(dir, mockClaude),
        skipGates: true,
        skipCharter: true,
        skipTriage: true,
        charterChecker: async () => {
          charterCalled = true;
          return passingCharterChecker();
        },
      });

      expect(charterCalled).toBe(false);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("skipTriage: true → triage not called, pipeline goes straight to plan", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-iter-"));
    let triageCalled = false;
    const calls: string[][] = [];

    const mockClaude = createIterateMock(
      { assess: "assessment", name: "test-name", plan: "plan", execute: "done" },
      { onCall: (args) => calls.push(args) },
    );

    try {
      const result = await iterate({
        ctx: makeCtx(dir, mockClaude),
        skipGates: true,
        skipCharter: true,
        skipTriage: true,
        triageRunner: async () => {
          triageCalled = true;
          return acceptingTriageRunner();
        },
      });

      expect(triageCalled).toBe(false);
      expect(result.triageResult).toBeNull();
      // 5 claude calls: assess, name, plan, execute, summarize (no triage)
      expect(calls.length).toBe(5);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

describe("sanitizeName", () => {
  test("extracts kebab-case name from clean LLM output", () => {
    expect(sanitizeName("fix-broken-auth-handler")).toBe("fix-broken-auth-handler");
  });

  test("extracts from output with surrounding markdown backticks", () => {
    expect(sanitizeName("`improve-error-handling`")).toBe("improve-error-handling");
  });

  test("caps at 50 characters", () => {
    const longName = "a".repeat(60);
    expect(sanitizeName(longName)).toBe("a".repeat(50));
  });

  test("returns empty string when no alphanumeric content", () => {
    expect(sanitizeName("!!!---!!!")).toBe("");
    expect(sanitizeName("")).toBe("");
  });

  test("extracts kebab-case name from surrounding prose", () => {
    expect(sanitizeName("The name is fix-auth")).toBe("fix-auth");
  });

  test("handles trailing newline", () => {
    expect(sanitizeName("fix-auth-bug\n")).toBe("fix-auth-bug");
  });

  test("lowercases input to handle mixed-case LLM output", () => {
    expect(sanitizeName("Fix-Broken-Auth")).toBe("fix-broken-auth");
    expect(sanitizeName("ALLCAPS")).toBe("allcaps");
  });

  test("prefers longest multi-segment kebab match", () => {
    expect(sanitizeName("Try fix-auth or fix-broken-auth-handler")).toBe("fix-broken-auth-handler");
  });

  test("falls back to single word when no kebab segments found", () => {
    expect(sanitizeName("refactor")).toBe("refactor");
  });
});

describe("buildRetryPrompt", () => {
  test("includes original plan and failed gate output", () => {
    const prompt = buildRetryPrompt(
      "/my/project",
      "Step 1: Fix the thing",
      "Assessment content",
      [{ name: "test", output: "FAIL: expected 1 got 2" }],
      [],
    );

    expect(prompt).toContain("## Original Plan");
    expect(prompt).toContain("Step 1: Fix the thing");
    expect(prompt).toContain("## Current Failed Gates");
    expect(prompt).toContain("### Gate: test");
    expect(prompt).toContain("FAIL: expected 1 got 2");
  });

  test("formats multiple failed gates", () => {
    const prompt = buildRetryPrompt(
      "/my/project",
      "Plan content",
      "Assessment content",
      [
        { name: "test", output: "test failure" },
        { name: "lint", output: "lint failure" },
      ],
      [],
    );

    expect(prompt).toContain("### Gate: test");
    expect(prompt).toContain("test failure");
    expect(prompt).toContain("### Gate: lint");
    expect(prompt).toContain("lint failure");
  });

  test("includes instruction to not regress", () => {
    const prompt = buildRetryPrompt("/my/project", "Plan", "Assessment", [{ name: "test", output: "fail" }], []);
    expect(prompt).toContain("Fix the failures below WITHOUT regressing");
  });

  test("includes goal section with folder and assessment", () => {
    const prompt = buildRetryPrompt(
      "/my/project",
      "Plan",
      "Assessment content here",
      [{ name: "test", output: "fail" }],
      [],
    );
    expect(prompt).toContain("## Goal");
    expect(prompt).toContain("/my/project");
    expect(prompt).toContain("## Assessment");
    expect(prompt).toContain("Assessment content here");
  });

  test("includes cumulative prior attempt history", () => {
    const prompt = buildRetryPrompt(
      "/my/project",
      "Plan",
      "Assessment",
      [{ name: "test", output: "FAIL: attempt 3 error" }],
      [
        { attempt: 1, failedGates: [{ name: "test", output: "FAIL: attempt 1 error" }] },
        { attempt: 2, failedGates: [{ name: "test", output: "FAIL: attempt 2 error" }] },
      ],
    );

    expect(prompt).toContain("## Attempt 1");
    expect(prompt).toContain("FAIL: attempt 1 error");
    expect(prompt).toContain("## Attempt 2");
    expect(prompt).toContain("FAIL: attempt 2 error");
    expect(prompt).toContain("## Current Failed Gates");
    expect(prompt).toContain("FAIL: attempt 3 error");
  });
});
