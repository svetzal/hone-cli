import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedDeriveArgs } from "./commands/resolve-derive-args.ts";
import { getDefaultConfig } from "./config.ts";
import { runDerive } from "./derive-command.ts";
import { createDeriveMock } from "./test-helpers.ts";

const CANNED_AGENT = `---
name: bun-typescript-craftsperson
description: A TypeScript craftsperson
---

# Bun TypeScript Craftsperson

## Engineering Principles
1. Write tests first
`;

const CANNED_GATES_JSON = `[{"name":"test","command":"bun test","required":true}]`;

function makeArgs(resolvedFolder: string, overrides: Partial<ResolvedDeriveArgs> = {}): ResolvedDeriveArgs {
  return {
    resolvedFolder,
    isGlobal: false,
    isJson: false,
    nameOverride: undefined,
    ...overrides,
  };
}

describe("runDerive", () => {
  describe("happy path", () => {
    it("returns DeriveOutcome with correct agentName and agentPath", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "hone-run-derive-"));
      try {
        const claude = createDeriveMock({ derive: CANNED_AGENT, gateExtraction: CANNED_GATES_JSON });
        const progress: string[] = [];
        const onProgress = (_stage: string, msg: string) => {
          progress.push(msg);
        };

        const outcome = await runDerive(
          makeArgs(tmpDir),
          { claude, prompt: async () => "o", config: getDefaultConfig() },
          onProgress,
        );

        expect(outcome).not.toBeNull();
        expect(outcome!.agentName).toBe("bun-typescript-craftsperson");
        expect(outcome!.agentPath).toContain("bun-typescript-craftsperson.md");
        expect(outcome!.agentWrite).toBe("written");
      } finally {
        await rm(tmpDir, { recursive: true });
      }
    });

    it("returns gates and gatesPath when gates are extracted", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "hone-run-derive-"));
      try {
        const claude = createDeriveMock({ derive: CANNED_AGENT, gateExtraction: CANNED_GATES_JSON });

        const outcome = await runDerive(
          makeArgs(tmpDir),
          { claude, prompt: async () => "o", config: getDefaultConfig() },
          () => {},
        );

        expect(outcome!.gates).toHaveLength(1);
        expect(outcome!.gates[0]!.name).toBe("test");
        expect(outcome!.gatesPath).toContain(".hone-gates.json");
      } finally {
        await rm(tmpDir, { recursive: true });
      }
    });

    it("returns null gates fields when no gates extracted", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "hone-run-derive-"));
      try {
        const claude = createDeriveMock({ derive: CANNED_AGENT, gateExtraction: "[]" });

        const outcome = await runDerive(
          makeArgs(tmpDir),
          { claude, prompt: async () => "o", config: getDefaultConfig() },
          () => {},
        );

        expect(outcome!.gates).toHaveLength(0);
        expect(outcome!.gatesPath).toBeNull();
        expect(outcome!.gateValidation).toBeNull();
      } finally {
        await rm(tmpDir, { recursive: true });
      }
    });
  });

  describe("--name override", () => {
    it("uses overridden name and updates frontmatter", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "hone-run-derive-"));
      try {
        const claude = createDeriveMock({ derive: CANNED_AGENT, gateExtraction: "[]" });

        const outcome = await runDerive(
          makeArgs(tmpDir, { nameOverride: "my-custom-agent" }),
          { claude, prompt: async () => "o", config: getDefaultConfig() },
          () => {},
        );

        expect(outcome!.agentName).toBe("my-custom-agent");
        expect(outcome!.agentPath).toContain("my-custom-agent.md");

        const written = await Bun.file(outcome!.agentPath).text();
        expect(written).toContain("name: my-custom-agent");
      } finally {
        await rm(tmpDir, { recursive: true });
      }
    });
  });

  describe("abort path", () => {
    it("returns null when user aborts conflict resolution", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "hone-run-derive-"));
      try {
        const agentDir = join(tmpDir, ".claude", "agents");
        await Bun.write(
          join(agentDir, "bun-typescript-craftsperson.md"),
          `---\nname: bun-typescript-craftsperson\ndescription: Existing\n---\n\n# Existing\n`,
        );

        const claude = createDeriveMock({ derive: CANNED_AGENT, gateExtraction: "[]" });

        const outcome = await runDerive(
          makeArgs(tmpDir),
          { claude, prompt: async () => "a", config: getDefaultConfig() },
          () => {},
        );

        expect(outcome).toBeNull();
      } finally {
        await rm(tmpDir, { recursive: true });
      }
    });
  });

  describe("onProgress calls", () => {
    it("emits progress messages without calling console directly", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "hone-run-derive-"));
      try {
        const claude = createDeriveMock({ derive: CANNED_AGENT, gateExtraction: "[]" });
        const stages: string[] = [];
        const messages: string[] = [];

        await runDerive(
          makeArgs(tmpDir),
          { claude, prompt: async () => "o", config: getDefaultConfig() },
          (stage, msg) => {
            stages.push(stage);
            messages.push(msg);
          },
        );

        expect(stages.every((s) => s === "derive")).toBe(true);
        expect(messages.some((m) => m.includes("Inspecting project"))).toBe(true);
        expect(messages.some((m) => m.includes("Agent written to"))).toBe(true);
      } finally {
        await rm(tmpDir, { recursive: true });
      }
    });
  });
});
