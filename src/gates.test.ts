import { describe, expect, test } from "bun:test";
import { runGate, runAllGates, truncateOutput } from "./gates.ts";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import type { GateDefinition } from "./types.ts";

describe("runGate", () => {
  test("returns passed result for successful command", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-test-"));
    try {
      const result = await runGate(
        { name: "test", command: "echo 'hello'", required: true },
        dir,
        10000,
      );

      expect(result.passed).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("hello");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("returns failed result for failing command", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-test-"));
    try {
      const result = await runGate(
        { name: "test", command: "exit 1", required: true },
        dir,
        10000,
      );

      expect(result.passed).toBe(false);
      expect(result.exitCode).toBe(1);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("captures stderr in output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-test-"));
    try {
      const result = await runGate(
        { name: "lint", command: "echo 'error' >&2", required: true },
        dir,
        10000,
      );

      expect(result.output).toContain("error");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("preserves gate metadata in result", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-test-"));
    try {
      const result = await runGate(
        { name: "security", command: "echo 'ok'", required: false },
        dir,
        10000,
      );

      expect(result.required).toBe(false);
      expect(result.name).toBe("security");
      expect(result.command).toBe("echo 'ok'");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("handles command timeout", { timeout: 15000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-test-"));
    try {
      const result = await runGate(
        { name: "slow", command: "sleep 2", required: true },
        dir,
        500, // 500ms timeout — kill fires before sleep finishes
      );

      expect(result.passed).toBe(false);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

describe("runAllGates", () => {
  test("returns all-passed when all gates succeed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-test-"));
    try {
      const gates: GateDefinition[] = [
        { name: "test", command: "echo ok", required: true },
        { name: "lint", command: "echo ok", required: true },
      ];

      const result = await runAllGates(gates, dir, 10000);

      expect(result.allPassed).toBe(true);
      expect(result.requiredPassed).toBe(true);
      expect(result.results.length).toBe(2);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("returns requiredPassed true when only optional gates fail", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-test-"));
    try {
      const gates: GateDefinition[] = [
        { name: "test", command: "echo ok", required: true },
        { name: "security", command: "exit 1", required: false },
      ];

      const result = await runAllGates(gates, dir, 10000);

      expect(result.allPassed).toBe(false);
      expect(result.requiredPassed).toBe(true);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("returns requiredPassed false when a required gate fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-test-"));
    try {
      const gates: GateDefinition[] = [
        { name: "test", command: "exit 1", required: true },
      ];

      const result = await runAllGates(gates, dir, 10000);

      expect(result.requiredPassed).toBe(false);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("returns all-passed with empty results when no gates provided", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-test-"));
    try {
      const result = await runAllGates([], dir, 10000);

      expect(result.allPassed).toBe(true);
      expect(result.requiredPassed).toBe(true);
      expect(result.results).toEqual([]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

describe("truncateOutput", () => {
  test("returns full output when under max lines", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i}`);
    const output = lines.join("\n");

    expect(truncateOutput(output, 200)).toBe(output);
  });

  test("truncates to last N lines with notice", () => {
    const lines = Array.from({ length: 250 }, (_, i) => `line ${i}`);
    const output = lines.join("\n");

    const result = truncateOutput(output, 200);

    expect(result).toContain("... (50 lines truncated)");
    expect(result).toContain("line 249"); // Last line should be present
    expect(result).not.toContain("line 0"); // First line should be truncated
  });

  test("uses default of 200 lines", () => {
    const lines = Array.from({ length: 300 }, (_, i) => `line ${i}`);
    const output = lines.join("\n");

    const result = truncateOutput(output);

    expect(result).toContain("... (100 lines truncated)");
  });
});
