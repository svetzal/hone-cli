import { describe, expect, test } from "bun:test";
import { iterate } from "./iterate.ts";
import { getDefaultConfig } from "./config.ts";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import type { ClaudeInvoker } from "./types.ts";

describe("iterate", () => {
  test("runs full cycle with mock claude invoker", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-iter-"));
    const calls: string[][] = [];

    const mockClaude: ClaudeInvoker = async (args) => {
      calls.push(args);

      // Determine which stage based on the prompt content
      const promptIdx = args.indexOf("-p");
      const prompt = promptIdx >= 0 ? args[promptIdx + 1]! : "";

      if (prompt.startsWith("Assess")) {
        return "The project violates the single responsibility principle.";
      }
      if (prompt.startsWith("Output ONLY")) {
        return "fix-srp-violation";
      }
      if (prompt.startsWith("Based on")) {
        return "Step 1: Extract class\nStep 2: Move methods";
      }
      if (prompt.startsWith("Execute")) {
        return "Extracted UserAuth class into its own module.";
      }
      return "unknown stage";
    };

    try {
      const progress: string[] = [];
      const result = await iterate(
        {
          agent: "test-agent",
          folder: dir,
          config: getDefaultConfig(),
          skipGates: true,
          onProgress: (stage, msg) => {
            progress.push(`${stage}: ${msg}`);
          },
        },
        mockClaude,
      );

      expect(result.name).toBe("fix-srp-violation");
      expect(result.assessment).toContain("single responsibility");
      expect(result.plan).toContain("Extract class");
      expect(result.execution).toContain("UserAuth");
      expect(result.success).toBe(true);
      expect(result.retries).toBe(0);

      // 4 claude calls: assess, name, plan, execute
      expect(calls.length).toBe(4);

      // Verify read-only stages use --allowedTools
      expect(calls[0]).toContain("--allowedTools");
      expect(calls[1]).toContain("--allowedTools");
      expect(calls[2]).toContain("--allowedTools");
      // Execute stage does NOT have --allowedTools
      expect(calls[3]).not.toContain("--allowedTools");

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

    const mockClaude: ClaudeInvoker = async (args) => {
      const promptIdx = args.indexOf("-p");
      const prompt = promptIdx >= 0 ? args[promptIdx + 1]! : "";

      if (prompt.startsWith("Assess")) return "assessment";
      if (prompt.startsWith("Output ONLY")) return "!!!INVALID!!!";
      if (prompt.startsWith("Based on")) return "plan";
      if (prompt.startsWith("Execute")) return "done";
      return "";
    };

    try {
      const result = await iterate(
        {
          agent: "test-agent",
          folder: dir,
          config: getDefaultConfig(),
          skipGates: true,
          onProgress: () => {},
        },
        mockClaude,
      );

      // Should fall back to assessment-<timestamp>
      expect(result.name).toMatch(/^assessment-\d+$/);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
