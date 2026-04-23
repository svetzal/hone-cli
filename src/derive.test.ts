import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractAgentName } from "./agent-frontmatter.ts";
import { buildDerivePrompt, derive, suggestExpandedName } from "./derive.ts";
import { updateFrontmatterName } from "./derive-conflict.ts";
import { gatherContext } from "./project-context.ts";
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
      expect(ctx.lockfiles).toEqual([]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("detects lockfiles and maps to package managers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-derive-"));
    try {
      await writeFile(join(dir, "bun.lockb"), "");
      await writeFile(join(dir, "package.json"), "{}");

      const ctx = await gatherContext(dir);

      expect(ctx.lockfiles).toEqual([{ file: "bun.lockb", packageManager: "bun" }]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("detects multiple lockfiles", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-derive-"));
    try {
      await writeFile(join(dir, "uv.lock"), "");
      await writeFile(join(dir, "poetry.lock"), "");

      const ctx = await gatherContext(dir);

      const managers = ctx.lockfiles.map((l) => l.packageManager).sort();
      expect(managers).toContain("uv");
      expect(managers).toContain("poetry");
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

describe("buildDerivePrompt", () => {
  test("includes lockfile information", () => {
    const prompt = buildDerivePrompt("/project", {
      directoryTree: "src/",
      packageFiles: ["package.json"],
      ciConfigs: [],
      toolConfigs: [],
      shellScripts: [],
      lockfiles: [{ file: "bun.lockb", packageManager: "bun" }],
    });

    expect(prompt).toContain("Lockfiles Detected");
    expect(prompt).toContain("bun.lockb (bun)");
  });

  test("includes existing agent names", () => {
    const prompt = buildDerivePrompt(
      "/project",
      {
        directoryTree: "",
        packageFiles: [],
        ciConfigs: [],
        toolConfigs: [],
        shellScripts: [],
        lockfiles: [],
      },
      ["typescript-craftsperson", "python-craftsperson"],
    );

    expect(prompt).toContain("Existing Agent Names");
    expect(prompt).toContain("typescript-craftsperson");
    expect(prompt).toContain("python-craftsperson");
  });

  test("omits lockfiles section when none detected", () => {
    const prompt = buildDerivePrompt("/project", {
      directoryTree: "",
      packageFiles: [],
      ciConfigs: [],
      toolConfigs: [],
      shellScripts: [],
      lockfiles: [],
    });

    expect(prompt).not.toContain("Lockfiles Detected");
  });

  test("omits existing agents section when list is empty", () => {
    const prompt = buildDerivePrompt(
      "/project",
      {
        directoryTree: "",
        packageFiles: [],
        ciConfigs: [],
        toolConfigs: [],
        shellScripts: [],
        lockfiles: [],
      },
      [],
    );

    expect(prompt).not.toContain("Existing Agent Names");
  });

  test("includes stronger naming convention with examples", () => {
    const prompt = buildDerivePrompt("/project", {
      directoryTree: "",
      packageFiles: [],
      ciConfigs: [],
      toolConfigs: [],
      shellScripts: [],
      lockfiles: [],
    });

    expect(prompt).toContain("runtime-or-pkg-manager");
    expect(prompt).toContain("bun-typescript-react-craftsperson");
    expect(prompt).toContain("uv-python-fastapi-craftsperson");
  });
});

describe("suggestExpandedName", () => {
  test("calls Claude and returns cleaned name", async () => {
    const mockClaude = async () => "  `bun-typescript-react-craftsperson`  ";

    const result = await suggestExpandedName(
      "typescript-craftsperson",
      {
        directoryTree: "",
        packageFiles: ["package.json"],
        ciConfigs: [],
        toolConfigs: ["tsconfig.json"],
        shellScripts: [],
        lockfiles: [{ file: "bun.lockb", packageManager: "bun" }],
      },
      ["typescript-craftsperson"],
      "haiku",
      "Read Glob Grep",
      mockClaude,
    );

    expect(result).toBe("bun-typescript-react-craftsperson");
  });

  test("includes project signals in prompt", async () => {
    let capturedPrompt = "";
    const mockClaude = async (args: string[]) => {
      capturedPrompt = extractPrompt(args);
      return "expanded-craftsperson";
    };

    await suggestExpandedName(
      "python-craftsperson",
      {
        directoryTree: "",
        packageFiles: ["pyproject.toml"],
        ciConfigs: [],
        toolConfigs: [],
        shellScripts: [],
        lockfiles: [{ file: "uv.lock", packageManager: "uv" }],
      },
      ["python-craftsperson"],
      "haiku",
      "Read Glob Grep",
      mockClaude,
    );

    expect(capturedPrompt).toContain("python-craftsperson");
    expect(capturedPrompt).toContain("uv.lock (uv)");
    expect(capturedPrompt).toContain("pyproject.toml");
  });
});

describe("updateFrontmatterName", () => {
  test("replaces name in frontmatter", () => {
    const content = `---
name: old-name
description: Test agent
---

# Content`;

    const result = updateFrontmatterName(content, "new-name");

    expect(result).toContain("name: new-name");
    expect(result).not.toContain("old-name");
    expect(result).toContain("description: Test agent");
    expect(result).toContain("# Content");
  });

  test("returns content unchanged when no frontmatter", () => {
    const content = "# No Frontmatter\n\nJust content";

    const result = updateFrontmatterName(content, "new-name");

    expect(result).toBe(content);
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
          gateExtraction: JSON.stringify([{ name: "test", command: "bun test", required: true }]),
        },
        {
          onCall: () => {
            callCount++;
          },
        },
      );

      const result = await derive(dir, "sonnet", "haiku", "Read Glob Grep", mockClaude);

      expect(result.agentName).toBe("test-craftsperson");
      expect(result.agentContent).toContain("Test Craftsperson");
      expect(result.gates.length).toBe(1);
      expect(result.gates[0]?.command).toBe("bun test");

      // Should have made 2 Claude calls (derive + gate extraction)
      expect(callCount).toBe(2);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("includes project context in result", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-derive-"));
    try {
      await writeFile(join(dir, "package.json"), '{"name":"test"}');
      await writeFile(join(dir, "bun.lockb"), "");

      const mockClaude = createDeriveMock({
        derive: "---\nname: test\n---\n# Test",
        gateExtraction: "[]",
      });

      const result = await derive(dir, "sonnet", "haiku", "Read Glob Grep", mockClaude);

      expect(result.context).toBeDefined();
      expect(result.context.packageFiles).toContain("package.json");
      expect(result.context.lockfiles).toEqual([{ file: "bun.lockb", packageManager: "bun" }]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  test("passes existing agent names to prompt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hone-derive-"));
    try {
      await writeFile(join(dir, "package.json"), '{"name":"test"}');

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

      await derive(dir, "sonnet", "haiku", "Read Glob Grep", mockClaude, ["existing-agent"]);

      expect(capturedPrompt).toContain("existing-agent");
      expect(capturedPrompt).toContain("Existing Agent Names");
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
