import { describe, expect, it, spyOn } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeriveGatesMock } from "../test-helpers.ts";
import type { ParsedArgs } from "../types.ts";
import { deriveGatesCommand } from "./derive-gates.ts";

const CANNED_GATES_JSON = `[{"name":"test","command":"bun test","required":true},{"name":"typecheck","command":"bunx tsc --noEmit","required":true}]`;

function makeParsed(positional: string[], flags: Record<string, string | boolean> = {}): ParsedArgs {
  return {
    command: "derive-gates",
    positional,
    flags,
  };
}

describe("deriveGatesCommand", () => {
  describe("argument validation", () => {
    it("exits with error when no args provided", async () => {
      const proc = Bun.spawn([process.execPath, "run", "src/cli.ts", "derive-gates"], {
        stdout: "pipe",
        stderr: "pipe",
        cwd: `${import.meta.dir}/../..`,
      });
      const exitCode = await proc.exited;
      const stderr = await new Response(proc.stderr).text();

      expect(exitCode).toBe(1);
      expect(stderr).toContain("Usage: hone derive-gates");
    });
  });

  describe("happy path with injected deps", () => {
    it("writes .hone-gates.json when gates are discovered", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "hone-derive-gates-cmd-"));
      try {
        const claude = createDeriveGatesMock(CANNED_GATES_JSON);

        await deriveGatesCommand(makeParsed([tmpDir]), { claude });

        const gatesPath = join(tmpDir, ".hone-gates.json");
        const gatesFile = await Bun.file(gatesPath).json();
        expect(gatesFile.gates).toBeArray();
        expect(gatesFile.gates.length).toBe(2);
        expect(gatesFile.gates[0].name).toBe("test");
        expect(gatesFile.gates[1].name).toBe("typecheck");
      } finally {
        await rm(tmpDir, { recursive: true });
      }
    });

    it("does not write .hone-gates.json when no gates are discovered", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "hone-derive-gates-cmd-"));
      try {
        const claude = createDeriveGatesMock("[]");

        await deriveGatesCommand(makeParsed([tmpDir]), { claude });

        const gatesFile = Bun.file(join(tmpDir, ".hone-gates.json"));
        expect(await gatesFile.exists()).toBe(false);
      } finally {
        await rm(tmpDir, { recursive: true });
      }
    });

    it("runs gates and produces validation results when --run flag is set", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "hone-derive-gates-cmd-"));
      try {
        // Use a command that is guaranteed to pass on any platform
        const passingGatesJson = `[{"name":"test","command":"true","required":true}]`;
        const claude = createDeriveGatesMock(passingGatesJson);

        await deriveGatesCommand(makeParsed([tmpDir], { run: true }), { claude });

        // Gates file must be written
        const gatesPath = join(tmpDir, ".hone-gates.json");
        const gatesFile = await Bun.file(gatesPath).json();
        expect(gatesFile.gates).toBeArray();
        expect(gatesFile.gates.length).toBe(1);
      } finally {
        await rm(tmpDir, { recursive: true });
      }
    });

    it("outputs structured JSON including gates and gatesPath when --json flag is set", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "hone-derive-gates-cmd-"));
      const capturedLogs: string[] = [];
      const logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        capturedLogs.push(args.map(String).join(" "));
      });

      try {
        const claude = createDeriveGatesMock(CANNED_GATES_JSON);

        await deriveGatesCommand(makeParsed([tmpDir], { json: true }), { claude });

        logSpy.mockRestore();

        // Find the JSON line (writeJson calls console.log with JSON.stringify)
        const jsonLine = capturedLogs.find((line) => {
          try {
            JSON.parse(line);
            return true;
          } catch {
            return false;
          }
        });
        expect(jsonLine).toBeDefined();
        // biome-ignore lint/style/noNonNullAssertion: toBeDefined() assertion above confirms jsonLine is non-null
        const jsonOutput = JSON.parse(jsonLine!);
        expect(jsonOutput).toHaveProperty("gates");
        expect(jsonOutput).toHaveProperty("gatesPath");
        expect(jsonOutput).toHaveProperty("agentUsed");
        expect(jsonOutput).toHaveProperty("gateValidation");
        expect(jsonOutput.gates).toBeArray();
        expect(jsonOutput.gates.length).toBe(2);
        expect(jsonOutput.agentUsed).toBeNull();
        expect(jsonOutput.gateValidation).toBeNull();
      } finally {
        logSpy.mockRestore();
        await rm(tmpDir, { recursive: true });
      }
    });

    it("warns and continues when named agent is not found", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "hone-derive-gates-cmd-"));
      const capturedLogs: string[] = [];
      const logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        capturedLogs.push(args.map(String).join(" "));
      });

      try {
        const claude = createDeriveGatesMock("[]");

        // Two positionals: agent-name + folder path — parseGatesArgs identifies first as agent
        await deriveGatesCommand(makeParsed(["nonexistent-agent-xyz", tmpDir]), { claude });

        logSpy.mockRestore();

        // progress() in non-JSON mode writes to console.log
        const allOutput = capturedLogs.join("\n");
        expect(allOutput).toContain("not found");
      } finally {
        logSpy.mockRestore();
        await rm(tmpDir, { recursive: true });
      }
    });
  });
});
