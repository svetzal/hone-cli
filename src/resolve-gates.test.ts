import { describe, expect, test } from "bun:test";
import { loadOverrideGates, resolveGates } from "./resolve-gates.ts";
import { join } from "path";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import type { ClaudeInvoker } from "./types.ts";

describe("loadOverrideGates", () => {
  test("returns gates from .hone-gates.json when present", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-test-"));
    try {
      await writeFile(
        join(dir, ".hone-gates.json"),
        JSON.stringify({
          gates: [
            { name: "test", command: "bun test", required: true },
            { name: "typecheck", command: "tsc --noEmit" },
          ],
        }),
      );

      const gates = await loadOverrideGates(dir);

      expect(gates).not.toBeNull();
      expect(gates!.length).toBe(2);
      expect(gates![0]!.command).toBe("bun test");
      expect(gates![1]!.name).toBe("typecheck");
      expect(gates![1]!.required).toBe(true); // defaults to true
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("returns null when .hone-gates.json does not exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-test-"));
    try {
      const gates = await loadOverrideGates(dir);
      expect(gates).toBeNull();
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("returns null for invalid JSON in .hone-gates.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-test-"));
    try {
      await writeFile(join(dir, ".hone-gates.json"), "not valid json {{{");

      const gates = await loadOverrideGates(dir);
      expect(gates).toBeNull();
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

describe("resolveGates", () => {
  test("uses override file when present (priority 1)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-test-"));
    try {
      await writeFile(
        join(dir, ".hone-gates.json"),
        JSON.stringify({
          gates: [
            { name: "test", command: "bun test", required: true },
          ],
        }),
      );

      // Mock claude should NOT be called when override exists
      const mockClaude: ClaudeInvoker = async () => {
        throw new Error("Should not be called");
      };

      const gates = await resolveGates(
        dir,
        "some-agent",
        "haiku",
        "Read Glob Grep",
        mockClaude,
      );

      expect(gates.length).toBe(1);
      expect(gates[0]!.command).toBe("bun test");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("falls back to agent extraction when no override (priority 2)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-test-"));
    try {
      // No .hone-gates.json — Claude extraction kicks in
      // Since the agent won't actually exist, extractGatesFromAgent will return []
      // because readAgentContent returns null for nonexistent agents
      const mockClaude: ClaudeInvoker = async () => {
        return JSON.stringify([
          { name: "test", command: "pytest", required: true },
        ]);
      };

      const gates = await resolveGates(
        dir,
        "nonexistent-agent",
        "haiku",
        "Read Glob Grep",
        mockClaude,
      );

      // Agent doesn't exist, so extractGatesFromAgent returns []
      expect(gates).toEqual([]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("returns empty array when no override and no agent gates (priority 3)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-test-"));
    try {
      const mockClaude: ClaudeInvoker = async () => "no gates found";

      const gates = await resolveGates(
        dir,
        "nonexistent-agent",
        "haiku",
        "Read Glob Grep",
        mockClaude,
      );

      expect(gates).toEqual([]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
