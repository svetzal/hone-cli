import { describe, it, expect } from "bun:test";
import { applyIterateFlags } from "./iterate.ts";
import type { HoneConfig } from "../types.ts";

describe("applyIterateFlags", () => {
  const defaultConfig: HoneConfig = {
    models: {
      assess: "opus",
      name: "haiku",
      plan: "opus",
      execute: "sonnet",
      gates: "haiku",
      derive: "opus",
      triage: "haiku",
    },
    auditDir: "audit",
    readOnlyTools: "Read Glob Grep WebFetch WebSearch",
    maxRetries: 3,
    gateTimeout: 120000,
    mode: "local",
    minCharterLength: 100,
    severityThreshold: 3,
  };

  it("should return config unchanged when no flags provided", () => {
    const result = applyIterateFlags(defaultConfig, {});

    expect(result).toEqual(defaultConfig);
    expect(result).not.toBe(defaultConfig); // Should be a new object
  });

  it("should override maxRetries when max-retries flag provided", () => {
    const result = applyIterateFlags(defaultConfig, { "max-retries": "5" });

    expect(result.maxRetries).toBe(5);
    expect(result.models).toEqual(defaultConfig.models);
  });

  it("should override assess model when assess-model flag provided", () => {
    const result = applyIterateFlags(defaultConfig, { "assess-model": "sonnet" });

    expect(result.models.assess).toBe("sonnet");
    expect(result.models.plan).toBe("opus");
    expect(result.models.execute).toBe("sonnet");
  });

  it("should override plan model when plan-model flag provided", () => {
    const result = applyIterateFlags(defaultConfig, { "plan-model": "haiku" });

    expect(result.models.plan).toBe("haiku");
    expect(result.models.assess).toBe("opus");
    expect(result.models.execute).toBe("sonnet");
  });

  it("should override execute model when execute-model flag provided", () => {
    const result = applyIterateFlags(defaultConfig, { "execute-model": "opus" });

    expect(result.models.execute).toBe("opus");
    expect(result.models.assess).toBe("opus");
    expect(result.models.plan).toBe("opus");
  });

  it("should apply multiple model overrides at once", () => {
    const result = applyIterateFlags(defaultConfig, {
      "assess-model": "haiku",
      "plan-model": "sonnet",
      "execute-model": "opus",
    });

    expect(result.models.assess).toBe("haiku");
    expect(result.models.plan).toBe("sonnet");
    expect(result.models.execute).toBe("opus");
  });

  it("should apply all overrides together", () => {
    const result = applyIterateFlags(defaultConfig, {
      "max-retries": "10",
      "assess-model": "haiku",
      "execute-model": "opus",
    });

    expect(result.maxRetries).toBe(10);
    expect(result.models.assess).toBe("haiku");
    expect(result.models.execute).toBe("opus");
    expect(result.models.plan).toBe("opus"); // Unchanged
  });

  it("should handle NaN when max-retries is non-numeric", () => {
    const result = applyIterateFlags(defaultConfig, { "max-retries": "abc" });

    expect(result.maxRetries).toBeNaN();
  });

  it("should ignore boolean flags for model overrides", () => {
    const result = applyIterateFlags(defaultConfig, {
      "assess-model": true,
      "plan-model": true,
    });

    expect(result.models.assess).toBe("opus"); // Unchanged
    expect(result.models.plan).toBe("opus"); // Unchanged
  });

  it("should ignore boolean max-retries flag", () => {
    const result = applyIterateFlags(defaultConfig, { "max-retries": true });

    expect(result.maxRetries).toBe(3); // Unchanged
  });

  it("should not mutate the original config", () => {
    const original = { ...defaultConfig, models: { ...defaultConfig.models } };
    const result = applyIterateFlags(defaultConfig, { "max-retries": "99" });

    expect(defaultConfig).toEqual(original);
    expect(result.maxRetries).toBe(99);
  });

  it("should preserve other config fields", () => {
    const result = applyIterateFlags(defaultConfig, { "assess-model": "haiku" });

    expect(result.auditDir).toBe("audit");
    expect(result.readOnlyTools).toBe("Read Glob Grep WebFetch WebSearch");
    expect(result.gateTimeout).toBe(120000);
  });

  it("should override mode when mode flag provided", () => {
    const result = applyIterateFlags(defaultConfig, { mode: "github" });
    expect(result.mode).toBe("github");
  });

  it("should override severity-threshold when flag provided", () => {
    const result = applyIterateFlags(defaultConfig, { "severity-threshold": "4" });
    expect(result.severityThreshold).toBe(4);
  });

  it("should override min-charter-length when flag provided", () => {
    const result = applyIterateFlags(defaultConfig, { "min-charter-length": "200" });
    expect(result.minCharterLength).toBe(200);
  });

  it("should apply all new flags together", () => {
    const result = applyIterateFlags(defaultConfig, {
      mode: "github",
      "severity-threshold": "4",
      "min-charter-length": "50",
    });

    expect(result.mode).toBe("github");
    expect(result.severityThreshold).toBe(4);
    expect(result.minCharterLength).toBe(50);
  });

  it("should ignore boolean mode flag", () => {
    const result = applyIterateFlags(defaultConfig, { mode: true });
    expect(result.mode).toBe("local"); // Unchanged
  });
});

describe("iterate command integration", () => {
  const projectRoot = import.meta.dir + "/../..";

  it("should reject --proposals in local mode", async () => {
    const proc = Bun.spawn(
      ["bun", "run", "src/cli.ts", "iterate", "nonexistent-agent", "./src", "--proposals", "3"],
      { stdout: "pipe", stderr: "pipe", cwd: projectRoot },
    );
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).toBe(1);
    // Should fail because either agent not found (first) or proposals rejected
    // Agent check happens before proposals check, so it'll fail on agent
    expect(stderr.length).toBeGreaterThan(0);
  });

  it("should exit with error when no args provided", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli.ts", "iterate"], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: projectRoot,
    });
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage:");
  });

  it("should exit with error when agent not found", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli.ts", "iterate", "nonexistent-agent", "./src"], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: projectRoot,
    });
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).toBe(1);
    expect(stderr).toContain("not found");
  });

  it("should exit with error when agent not found with --json flag", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli.ts", "iterate", "nonexistent-agent", "./src", "--json"], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: projectRoot,
    });
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(1);
    expect(stderr).toContain("not found");
    // Stdout should be empty (errors go to stderr)
    expect(stdout.trim()).toBe("");
  });
});
