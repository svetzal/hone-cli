import { describe, expect, test } from "bun:test";
import { maintain, buildMaintainPrompt, buildMaintainRetryPrompt } from "./maintain.ts";
import { getDefaultConfig } from "./config.ts";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import type { GateDefinition, GatesRunResult } from "./types.ts";
import { createMaintainMock, extractPrompt, emptyGateResolver, standardGateResolver } from "./test-helpers.ts";

describe("maintain", () => {
  test("no gates resolved → exits with error, no Claude calls", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-maintain-"));
    const calls: string[][] = [];

    const mockClaude = createMaintainMock("done", { onCall: (args) => calls.push(args) });

    try {
      const result = await maintain(
        {
          agent: "test-agent",
          folder: dir,
          config: getDefaultConfig(),
          gateResolver: emptyGateResolver,
          onProgress: () => {},
        },
        mockClaude,
      );

      expect(result.success).toBe(false);
      expect(result.name).toBe("");
      expect(result.gatesResult).toBeNull();
      expect(result.headline).toBeNull();
      expect(result.summary).toBeNull();
      expect(calls.length).toBe(0);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("execute succeeds, all gates pass on first verify → success, 2 Claude calls", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-maintain-"));
    const calls: string[][] = [];

    const mockClaude = createMaintainMock(
      {
        execute: "Updated all dependencies.",
        summarize: '```json\n{ "headline": "Update project dependencies", "summary": "Bumped all packages to latest." }\n```',
      },
      { onCall: (args) => calls.push(args) },
    );

    const mockGateRunner = async (): Promise<GatesRunResult> => ({
      allPassed: true,
      requiredPassed: true,
      results: [
        { name: "test", command: "bun test", passed: true, required: true, output: "ok", exitCode: 0 },
      ],
    });

    try {
      const result = await maintain(
        {
          agent: "test-agent",
          folder: dir,
          config: getDefaultConfig(),
          gateRunner: mockGateRunner,
          gateResolver: standardGateResolver,
          onProgress: () => {},
        },
        mockClaude,
      );

      expect(result.success).toBe(true);
      expect(result.retries).toBe(0);
      expect(result.name).toMatch(/^maintain-\d{4}-\d{2}-\d{2}-\d{6}$/);
      expect(result.execution).toBe("Updated all dependencies.");
      expect(result.headline).toBe("Update project dependencies");
      expect(result.summary).toBe("Bumped all packages to latest.");
      // 2 Claude calls: execute + summarize
      expect(calls.length).toBe(2);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("gates fail after execute, retry fixes them → success, 3 Claude calls", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-maintain-"));
    const calls: string[][] = [];

    const mockClaude = createMaintainMock(
      { execute: "Fixed.", summarize: '{ "headline": "Fix deps", "summary": "Fixed." }' },
      { onCall: (args) => calls.push(args) },
    );

    let gateCallCount = 0;
    const mockGateRunner = async (): Promise<GatesRunResult> => {
      gateCallCount++;
      if (gateCallCount === 1) {
        return {
          allPassed: false,
          requiredPassed: false,
          results: [
            { name: "test", command: "bun test", passed: false, required: true, output: "FAIL: type error", exitCode: 1 },
          ],
        };
      }
      return {
        allPassed: true,
        requiredPassed: true,
        results: [
          { name: "test", command: "bun test", passed: true, required: true, output: "ok", exitCode: 0 },
        ],
      };
    };

    try {
      const result = await maintain(
        {
          agent: "test-agent",
          folder: dir,
          config: getDefaultConfig(),
          gateRunner: mockGateRunner,
          gateResolver: standardGateResolver,
          onProgress: () => {},
        },
        mockClaude,
      );

      expect(result.success).toBe(true);
      expect(result.retries).toBe(1);
      // 3 Claude calls: initial execute + 1 retry + summarize
      expect(calls.length).toBe(3);

      // Verify retry prompt contains failed gate output
      const retryPrompt = extractPrompt(calls[1]!);
      expect(retryPrompt).toContain("## Failed Gates");
      expect(retryPrompt).toContain("FAIL: type error");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("gates fail, max retries exhausted → failure", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-maintain-"));
    const calls: string[][] = [];

    const mockClaude = createMaintainMock("Tried.", { onCall: (args) => calls.push(args) });

    const mockGateRunner = async (): Promise<GatesRunResult> => ({
      allPassed: false,
      requiredPassed: false,
      results: [
        { name: "test", command: "bun test", passed: false, required: true, output: "FAIL: persistent", exitCode: 1 },
      ],
    });

    try {
      const config = getDefaultConfig();
      config.maxRetries = 2;

      const result = await maintain(
        {
          agent: "test-agent",
          folder: dir,
          config,
          gateRunner: mockGateRunner,
          gateResolver: standardGateResolver,
          onProgress: () => {},
        },
        mockClaude,
      );

      expect(result.success).toBe(false);
      expect(result.retries).toBe(2);
      expect(result.headline).toBeNull();
      expect(result.summary).toBeNull();
      // 3 Claude calls: initial execute + 2 retries
      expect(calls.length).toBe(3);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("optional gate fails only → still success, summarize called", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-maintain-"));
    const calls: string[][] = [];

    const mockClaude = createMaintainMock(
      { execute: "Updated.", summarize: '{ "headline": "Update deps", "summary": "Done." }' },
      { onCall: (args) => calls.push(args) },
    );

    const optionalGateResolver = async () => [
      { name: "security", command: "npm audit", required: false },
    ] as GateDefinition[];

    const mockGateRunner = async (): Promise<GatesRunResult> => ({
      allPassed: false,
      requiredPassed: true,
      results: [
        { name: "security", command: "npm audit", passed: false, required: false, output: "2 vulns", exitCode: 1 },
      ],
    });

    try {
      const result = await maintain(
        {
          agent: "test-agent",
          folder: dir,
          config: getDefaultConfig(),
          gateRunner: mockGateRunner,
          gateResolver: optionalGateResolver,
          onProgress: () => {},
        },
        mockClaude,
      );

      expect(result.success).toBe(true);
      expect(result.retries).toBe(0);
      expect(result.gatesResult?.allPassed).toBe(false);
      expect(result.gatesResult?.requiredPassed).toBe(true);
      expect(result.headline).toBe("Update deps");
      expect(result.summary).toBe("Done.");
      // 2 Claude calls: execute + summarize
      expect(calls.length).toBe(2);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("audit files created with maintain-* naming", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-maintain-"));

    const mockClaude = createMaintainMock("Updated deps.");

    const mockGateRunner = async (): Promise<GatesRunResult> => ({
      allPassed: true,
      requiredPassed: true,
      results: [],
    });

    try {
      const result = await maintain(
        {
          agent: "test-agent",
          folder: dir,
          config: getDefaultConfig(),
          gateRunner: mockGateRunner,
          gateResolver: standardGateResolver,
          onProgress: () => {},
        },
        mockClaude,
      );

      expect(result.name).toMatch(/^maintain-/);

      const auditDir = join(dir, "audit");
      const actionsFile = Bun.file(join(auditDir, `${result.name}-actions.md`));
      expect(await actionsFile.exists()).toBe(true);
      expect(await actionsFile.text()).toBe("Updated deps.");
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

describe("buildMaintainPrompt", () => {
  test("includes gate names and commands", () => {
    const gates: GateDefinition[] = [
      { name: "test", command: "bun test", required: true },
      { name: "lint", command: "bun lint", required: true },
      { name: "security", command: "npm audit", required: false },
    ];

    const prompt = buildMaintainPrompt("/my/project", gates);

    expect(prompt).toContain("/my/project");
    expect(prompt).toContain("- test: `bun test`");
    expect(prompt).toContain("- lint: `bun lint`");
    expect(prompt).toContain("- security: `npm audit` (optional)");
    expect(prompt).toContain("Update the project dependencies");
  });
});

describe("buildMaintainRetryPrompt", () => {
  test("includes failed gate output", () => {
    const prompt = buildMaintainRetryPrompt([
      { name: "test", output: "FAIL: expected 1 got 2" },
    ]);

    expect(prompt).toContain("## Failed Gates");
    expect(prompt).toContain("### Gate: test");
    expect(prompt).toContain("FAIL: expected 1 got 2");
  });

  test("formats multiple failed gates", () => {
    const prompt = buildMaintainRetryPrompt([
      { name: "test", output: "test failure" },
      { name: "lint", output: "lint failure" },
    ]);

    expect(prompt).toContain("### Gate: test");
    expect(prompt).toContain("test failure");
    expect(prompt).toContain("### Gate: lint");
    expect(prompt).toContain("lint failure");
  });

  test("includes instruction about not reverting", () => {
    const prompt = buildMaintainRetryPrompt([{ name: "test", output: "fail" }]);
    expect(prompt).toContain("without reverting the dependency updates");
  });
});
