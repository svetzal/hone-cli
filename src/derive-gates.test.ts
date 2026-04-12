import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDeriveGatesPrompt, deriveGates } from "./derive-gates.ts";
import { createDeriveGatesMock, extractPrompt } from "./test-helpers.ts";

describe("buildDeriveGatesPrompt", () => {
  test("includes folder path and project context", () => {
    const prompt = buildDeriveGatesPrompt("/some/project", {
      directoryTree: "src/\n  index.ts",
      packageFiles: ["package.json"],
      ciConfigs: [],
      toolConfigs: ["tsconfig.json"],
      shellScripts: [],
      lockfiles: [],
    });

    expect(prompt).toContain("/some/project");
    expect(prompt).toContain("package.json");
    expect(prompt).toContain("tsconfig.json");
    expect(prompt).toContain("discovering quality gates");
  });

  test("includes agent content when provided", () => {
    const prompt = buildDeriveGatesPrompt(
      "/some/project",
      {
        directoryTree: "",
        packageFiles: [],
        ciConfigs: [],
        toolConfigs: [],
        shellScripts: [],
        lockfiles: [],
      },
      "# My Agent\n\n## QA Checkpoints\n- Run bun test",
    );

    expect(prompt).toContain("Agent Context");
    expect(prompt).toContain("My Agent");
    expect(prompt).toContain("QA Checkpoints");
  });

  test("omits agent section when no agent provided", () => {
    const prompt = buildDeriveGatesPrompt("/some/project", {
      directoryTree: "",
      packageFiles: [],
      ciConfigs: [],
      toolConfigs: [],
      shellScripts: [],
      lockfiles: [],
    });

    expect(prompt).not.toContain("Agent Context");
  });

  test("includes CI configs when present", () => {
    const prompt = buildDeriveGatesPrompt("/some/project", {
      directoryTree: "",
      packageFiles: [],
      ciConfigs: [".github/workflows/ci.yml"],
      toolConfigs: [],
      shellScripts: [],
      lockfiles: [],
    });

    expect(prompt).toContain(".github/workflows/ci.yml");
  });

  test("includes shell scripts when present", () => {
    const prompt = buildDeriveGatesPrompt("/some/project", {
      directoryTree: "",
      packageFiles: [],
      ciConfigs: [],
      toolConfigs: [],
      shellScripts: ["run-tests.sh"],
      lockfiles: [],
    });

    expect(prompt).toContain("run-tests.sh");
  });
});

describe("deriveGates", () => {
  test("calls Claude once and returns parsed gates", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-derive-gates-"));
    try {
      await writeFile(join(dir, "package.json"), '{"name":"test","scripts":{"test":"bun test"}}');

      let callCount = 0;
      const mockClaude = createDeriveGatesMock(
        JSON.stringify([
          { name: "test", command: "bun test", required: true },
          { name: "typecheck", command: "bunx tsc --noEmit", required: true },
        ]),
        {
          onCall: () => {
            callCount++;
          },
        },
      );

      const gates = await deriveGates(dir, "sonnet", "Read Glob Grep", mockClaude);

      expect(callCount).toBe(1);
      expect(gates.length).toBe(2);
      expect(gates[0]?.name).toBe("test");
      expect(gates[0]?.command).toBe("bun test");
      expect(gates[1]?.name).toBe("typecheck");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("passes agent content to prompt when provided", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-derive-gates-"));
    try {
      await writeFile(join(dir, "package.json"), '{"name":"test"}');

      let capturedPrompt = "";
      const mockClaude = createDeriveGatesMock("[]", {
        onCall: (args) => {
          capturedPrompt = extractPrompt(args);
        },
      });

      await deriveGates(dir, "sonnet", "Read Glob Grep", mockClaude, "# My Agent Content");

      expect(capturedPrompt).toContain("My Agent Content");
      expect(capturedPrompt).toContain("Agent Context");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("returns empty gates on invalid Claude output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-derive-gates-"));
    try {
      const mockClaude = createDeriveGatesMock("not valid json at all");

      const gates = await deriveGates(dir, "sonnet", "Read Glob Grep", mockClaude);

      expect(gates).toEqual([]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("returns empty gates on Claude error", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-derive-gates-"));
    try {
      const mockClaude = async () => {
        throw new Error("Claude failed");
      };

      const gates = await deriveGates(dir, "sonnet", "Read Glob Grep", mockClaude);

      expect(gates).toEqual([]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
