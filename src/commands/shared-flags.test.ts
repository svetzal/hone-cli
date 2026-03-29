import { describe, it, expect } from "bun:test";
import { applySharedFlags } from "./shared-flags.ts";
import type { HoneConfig } from "../types.ts";

describe("applySharedFlags", () => {
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
    const result = applySharedFlags(defaultConfig, {});
    expect(result).toEqual(defaultConfig);
    expect(result).not.toBe(defaultConfig);
  });

  it("should override maxRetries when max-retries flag provided", () => {
    const result = applySharedFlags(defaultConfig, { "max-retries": "5" });
    expect(result.maxRetries).toBe(5);
  });

  it("should override execute model when execute-model flag provided", () => {
    const result = applySharedFlags(defaultConfig, { "execute-model": "opus" });
    expect(result.models.execute).toBe("opus");
  });

  it("should override summarize model when summarize-model flag provided", () => {
    const result = applySharedFlags(defaultConfig, { "summarize-model": "opus" });
    expect(result.models.summarize).toBe("opus");
  });

  it("should override auditDir when audit-dir flag provided", () => {
    const result = applySharedFlags(defaultConfig, { "audit-dir": "/tmp/audit" });
    expect(result.auditDir).toBe("/tmp/audit");
  });

  it("should apply all four shared flags together", () => {
    const result = applySharedFlags(defaultConfig, {
      "max-retries": "10",
      "execute-model": "haiku",
      "summarize-model": "sonnet",
      "audit-dir": "/custom/audit",
    });
    expect(result.maxRetries).toBe(10);
    expect(result.models.execute).toBe("haiku");
    expect(result.models.summarize).toBe("sonnet");
    expect(result.auditDir).toBe("/custom/audit");
  });

  it("should ignore boolean flags for all shared fields", () => {
    const result = applySharedFlags(defaultConfig, {
      "max-retries": true,
      "execute-model": true,
      "summarize-model": true,
      "audit-dir": true,
    });
    expect(result.maxRetries).toBe(3);
    expect(result.models.execute).toBe("sonnet");
    expect(result.models.summarize).toBe("haiku");
    expect(result.auditDir).toBe("audit");
  });

  it("should not mutate the original config", () => {
    const original = { ...defaultConfig, models: { ...defaultConfig.models } };
    applySharedFlags(defaultConfig, { "max-retries": "99" });
    expect(defaultConfig).toEqual(original);
  });

  it("should preserve unrelated config fields", () => {
    const result = applySharedFlags(defaultConfig, { "execute-model": "haiku" });
    expect(result.readOnlyTools).toBe("Read Glob Grep WebFetch WebSearch");
    expect(result.gateTimeout).toBe(120000);
    expect(result.mode).toBe("local");
    expect(result.models.assess).toBe("opus");
    expect(result.models.plan).toBe("opus");
  });
});
