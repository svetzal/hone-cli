import { describe, expect, test } from "bun:test";
import { gatherContext, extractAgentName, derive } from "./derive.ts";
import { join } from "path";
import { mkdtemp, writeFile, mkdir, rm } from "fs/promises";
import { tmpdir } from "os";
import { createDeriveMock, extractPrompt } from "./test-helpers.ts";

describe("gatherContext", () => {
  test("collects directory tree", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-derive-"));
    try {
      await mkdir(join(dir, "src"));
      await writeFile(join(dir, "src", "index.ts"), "console.log('hi')");
      await writeFile(join(dir, "package.json"), '{"name":"test"}');

      const ctx = await gatherContext(dir);

      expect(ctx.directoryTree).toContain("src/");
      expect(ctx.directoryTree).toContain("package.json");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("detects package files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-derive-"));
    try {
      await writeFile(join(dir, "package.json"), '{"name":"test","scripts":{"test":"bun test"}}');

      const ctx = await gatherContext(dir);

      expect(ctx.packageFiles).toContain("package.json");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("detects tool config files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-derive-"));
    try {
      await writeFile(join(dir, "tsconfig.json"), '{"compilerOptions":{}}');

      const ctx = await gatherContext(dir);

      expect(ctx.toolConfigs).toContain("tsconfig.json");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("skips node_modules and hidden dirs in tree", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-derive-"));
    try {
      await mkdir(join(dir, "node_modules"));
      await writeFile(join(dir, "node_modules", "pkg.json"), "{}");
      await mkdir(join(dir, ".git"));
      await writeFile(join(dir, ".git", "config"), "");
      await writeFile(join(dir, "app.ts"), "");

      const ctx = await gatherContext(dir);

      expect(ctx.directoryTree).toContain("app.ts");
      expect(ctx.directoryTree).not.toContain("node_modules");
      expect(ctx.directoryTree).not.toContain(".git");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("handles empty project directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-derive-"));
    try {
      const ctx = await gatherContext(dir);

      expect(ctx.directoryTree).toBe("");
      expect(ctx.packageFiles).toEqual([]);
      expect(ctx.ciConfigs).toEqual([]);
      expect(ctx.toolConfigs).toEqual([]);
      expect(ctx.shellScripts).toEqual([]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

describe("extractAgentName", () => {
  test("extracts name from YAML frontmatter", () => {
    const content = `---
name: typescript-craftsperson
description: TypeScript expert
---

# TypeScript Craftsperson`;

    expect(extractAgentName(content)).toBe("typescript-craftsperson");
  });

  test("extracts name from heading when no frontmatter", () => {
    const content = "# My Custom Agent\n\nSome content";

    expect(extractAgentName(content)).toBe("my-custom-agent");
  });

  test("handles quoted name in frontmatter", () => {
    const content = `---
name: "python-craftsperson"
---`;

    expect(extractAgentName(content)).toBe("python-craftsperson");
  });

  test("returns default when no name found", () => {
    const content = "Just some text without structure";

    expect(extractAgentName(content)).toBe("derived-agent");
  });
});

describe("derive", () => {
  test("calls Claude with project context and returns result", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-derive-"));
    try {
      await writeFile(join(dir, "package.json"), '{"name":"test","scripts":{"test":"bun test"}}');

      let callCount = 0;
      const mockClaude = createDeriveMock(
        {
          derive: `---
name: test-craftsperson
description: Test agent
---

# Test Craftsperson

## QA Checkpoints
- Run \`bun test\``,
          gateExtraction: JSON.stringify([
            { name: "test", command: "bun test", required: true },
          ]),
        },
        { onCall: () => { callCount++; } },
      );

      const result = await derive(dir, "sonnet", "haiku", "Read Glob Grep", mockClaude);

      expect(result.agentName).toBe("test-craftsperson");
      expect(result.agentContent).toContain("Test Craftsperson");
      expect(result.gates.length).toBe(1);
      expect(result.gates[0]!.command).toBe("bun test");

      // Should have made 2 Claude calls (derive + gate extraction)
      expect(callCount).toBe(2);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("prompt includes exploration instructions and file hints", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-derive-"));
    try {
      await writeFile(join(dir, "package.json"), '{"name":"my-app"}');
      await writeFile(join(dir, "tsconfig.json"), '{"compilerOptions":{"strict":true}}');

      let capturedPrompt = "";
      const mockClaude = createDeriveMock(
        {
          derive: "---\nname: test\n---\n# Test",
          gateExtraction: "[]",
        },
        {
          onCall: (args) => {
            const prompt = extractPrompt(args);
            if (prompt.includes("creating a custom craftsperson agent")) {
              capturedPrompt = prompt;
            }
          },
        },
      );

      await derive(dir, "sonnet", "haiku", "Read Glob Grep", mockClaude);

      // Should contain the project location
      expect(capturedPrompt).toContain(dir);
      // Should contain tool usage instructions
      expect(capturedPrompt).toContain("Read");
      expect(capturedPrompt).toContain("Glob");
      expect(capturedPrompt).toContain("Grep");
      // Should contain file names as hints
      expect(capturedPrompt).toContain("package.json");
      expect(capturedPrompt).toContain("tsconfig.json");
      // Should NOT contain file contents (exploration-based, not context-stuffed)
      expect(capturedPrompt).not.toContain("my-app");
      expect(capturedPrompt).not.toContain("strict");
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
