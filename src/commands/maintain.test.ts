import { describe, expect, it } from "bun:test";
import type { HoneConfig } from "../types.ts";
import { applyMaintainFlags } from "./maintain.ts";

describe("applyMaintainFlags", () => {
  const defaultConfig: HoneConfig = {
    models: {
      assess: "opus",
      name: "haiku",
      plan: "opus",
      execute: "sonnet",
      gates: "haiku",
      derive: "opus",
      triage: "haiku",
      mix: "opus",
      summarize: "haiku",
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
    const result = applyMaintainFlags(defaultConfig, {});
    expect(result).toEqual(defaultConfig);
    expect(result).not.toBe(defaultConfig);
  });

  it("should not mutate the original config", () => {
    const original = { ...defaultConfig, models: { ...defaultConfig.models } };
    applyMaintainFlags(defaultConfig, { "max-retries": "99" });
    expect(defaultConfig).toEqual(original);
  });
});

describe("maintain command integration", () => {
  const projectRoot = `${import.meta.dir}/../..`;

  it("should exit with error when no args provided", async () => {
    const proc = Bun.spawn([process.execPath, "run", "src/cli.ts", "maintain"], {
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
    const proc = Bun.spawn([process.execPath, "run", "src/cli.ts", "maintain", "nonexistent-agent", "./src"], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: projectRoot,
    });
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(exitCode).toBe(1);
    expect(stderr).toContain("not found");
  });

  it("should show maintain in help output", async () => {
    const proc = Bun.spawn([process.execPath, "run", "src/cli.ts", "--help"], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: projectRoot,
    });
    await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(stdout).toContain("maintain");
  });
});
